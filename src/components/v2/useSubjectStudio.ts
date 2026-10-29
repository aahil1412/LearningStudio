import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import type {
  StudioData,
  Lesson,
  ModelInfo,
  AuthStatus,
  Message,
} from "../../types";
import type {
  Subject,
  SubjectSnapshot,
  CurriculumNode,
  VisualInstance,
  TextbookChapter,
  SubjectRecord,
  ChapterProposal,
  SubjectSearchResult,
  SubjectDepth,
} from "../../v2types";
import { invoke, isDesktop } from "../../lib/bridge";
import { boundedConversation } from "../../lib/subjectAi";
import { parseTutorResponse } from "../../lib/visualSpecs";
import { teachingInstructions } from "../../lib/teaching";
import { flushVisualSources } from "../../lib/visualState";
import { flushCanvasWrites } from "./LearningCanvas";
import { chapterFromRecord, visualFromRecord } from "../../lib/v2records";
import { resolvePlanningPreference } from "../../lib/planningPreferences";
import { sourceStudyInstructions } from "../../lib/sourceTeaching";
import type { StudySourceContext } from "../../sourceStudyTypes";
export type StudioView =
  | "workspace"
  | "graph"
  | "library"
  | "research"
  | "review"
  | "subjects"
  | "subject"
  | "textbook"
  | "visuals"
  | "canvas"
  | "documents"
  | "annotations";
type Options = {
  data: StudioData;
  setData: Dispatch<SetStateAction<StudioData>>;
  loaded: boolean;
  active?: Lesson;
  models: ModelInfo[];
  auth: AuthStatus;
  saveQueue: MutableRefObject<Promise<void>>;
  setView: (view: StudioView) => void;
  setToast: (text: string) => void;
};
export function useSubjectStudio({
  data,
  setData,
  loaded,
  active,
  models,
  auth,
  saveQueue,
  setView,
  setToast,
}: Options) {
  const [subjects, setSubjects] = useState<Subject[]>([]),
    [snapshot, setSnapshot] = useState<SubjectSnapshot | null>(null),
    [visuals, setVisuals] = useState<VisualInstance[]>([]),
    [exportOpen, setExportOpen] = useState(false),
    [exportScope, setExportScope] = useState<"selection" | "subject">(
      "selection",
    ),
    [documentId, setDocumentId] = useState<string>(),
    [pdfUrl, setPdfUrl] = useState<string>(),
    [ancestors, setAncestors] = useState<Message[]>([]),
    [focusRecord, setFocusRecord] = useState<string>(),
    [focusResourceId, setFocusResourceId] = useState<string>(),
    [restoreGeneration, setRestoreGeneration] = useState(0),
    [focusTarget, setFocusTarget] = useState<{
      kind: "curriculum" | "concept" | "memory";
      id: string;
      key: string;
    }>();
  const refreshVersion = useRef(0);
  const pending = useRef(Promise.resolve()),
    revisions = useRef(new Map<string, number>()),
    savedTimes = useRef(new Map<string, string>()),
    current = useRef(data);
  current.current = data;
  const subjectId =
    data.activeSubjectId ||
    active?.subjectId ||
    subjects.find((subject) => subject.name === "General")?.id;
  const subjectIdRef = useRef(subjectId);
  subjectIdRef.current = subjectId;
  const refresh = useCallback(async (id = subjectIdRef.current) => {
    if (!isDesktop) return;
    const version = ++refreshVersion.current;
    const list = await invoke<Subject[]>("subject:list", {
      includeArchived: true,
    });
    setSubjects(list);
    if (!id) return;
    const [value, visualRecords, chapterRecords] = await Promise.all([
      invoke<SubjectSnapshot>("subject:get", { subjectId: id }),
      invoke<SubjectRecord[]>("subject:record-list", {
        subjectId: id,
        recordType: "visual",
        includeData: true,
        limit: 2000,
      }),
      invoke<SubjectRecord[]>("subject:record-list", {
        subjectId: id,
        recordType: "chapter",
        includeData: true,
        limit: 2000,
      }),
    ]);
    if (id !== subjectIdRef.current || version !== refreshVersion.current)
      return;
    const records = new Map(
      [...visualRecords, ...chapterRecords].map((record) => [
        record.id,
        record,
      ]),
    );
    value.records = value.records.map(
      (record) => records.get(record.id) || record,
    );
    setSnapshot(value);
    const savedVisuals = value.records.filter(
        (record) => record.recordType === "visual",
      ),
      items = savedVisuals
        .map(visualFromRecord)
        .filter((item): item is VisualInstance => !!item);
    if (items.length < savedVisuals.length)
      setToast(
        "A saved visual has invalid content. Its original record is preserved; other lessons and visuals remain available.",
      );
    for (const item of items) {
      revisions.current.set(
        item.id,
        Math.max(revisions.current.get(item.id) || 0, item.revision || 0),
      );
      if (!savedTimes.current.has(item.id))
        savedTimes.current.set(item.id, item.updatedAt);
    }
    setVisuals(items);
  }, []);
  useEffect(() => {
    if (loaded)
      void refresh(subjectId).catch((error) => setToast(String(error)));
  }, [loaded, subjectId, refresh]);
  useEffect(() => {
    if (!loaded || !active || active.subjectId) return;
    let stale = false;
    void Promise.resolve()
      .then(() => saveQueue.current)
      .then(() =>
        invoke<{ subjectId: string } | null>("subject:conversation-get", {
          conversationId: active.id,
        }),
      )
      .then((meta) => {
        if (stale || !meta?.subjectId) return;
        setData((value) => ({
          ...value,
          activeSubjectId: meta.subjectId,
          lessons: value.lessons.map((lesson) =>
            lesson.id === active.id
              ? { ...lesson, subjectId: meta.subjectId }
              : lesson,
          ),
        }));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [loaded, active?.id, active?.subjectId]);
  useEffect(
    () =>
      window.studio?.onDataChanged?.(() => {
        void refresh().catch(() => {});
      }),
    [refresh],
  );
  useEffect(() => {
    if (!active?.parentConversationId) {
      setAncestors([]);
      return;
    }
    let stale = false;
    void invoke<Message[]>("subject:transcript", {
      conversationId: active.id,
      limit: 10000,
    }).then((messages) => {
      if (!stale)
        setAncestors(
          messages.filter(
            (message) => !active.messages.some((own) => own.id === message.id),
          ),
        );
    });
    return () => {
      stale = true;
    };
  }, [active?.id, active?.parentConversationId, restoreGeneration]);
  useEffect(() => {
    setPdfUrl(undefined);
    const resource = data.library.find((item) => item.id === documentId);
    if (!resource?.sourceAssetId) return;
    let stale = false;
    void invoke<string | null>("documents:pdf-url", { resourceId: resource.id })
      .then((url) => {
        if (!stale) setPdfUrl(url || undefined);
      })
      .catch((error) => setToast(String(error)));
    return () => {
      stale = true;
    };
  }, [documentId]);
  const reloadData = async () => {
    const canonical = await invoke<StudioData>("data:load");
    setData((value) => ({
      ...canonical,
      activeSubjectId: value.activeSubjectId,
      activeLessonId: canonical.lessons.some(
        (lesson) => lesson.id === value.activeLessonId,
      )
        ? value.activeLessonId
        : canonical.activeLessonId,
    }));
  };
  const action = async (
    name: string,
    payload: Record<string, unknown> = {},
  ) => {
    await saveQueue.current;
    await pending.current;
    await invoke("data:save", current.current);
    const result = await invoke<any>(name, payload);
    if (
      ![
        "subject:record-put",
        "subject:record-delete",
        "subject:record-revise",
        "subject:search",
      ].includes(name)
    )
      await reloadData();
    await refresh();
    return result;
  };
  const openSubject = (id: string) => {
    void flush()
      .then(() => {
        setData((value) => ({
          ...value,
          activeSubjectId: id,
          activeLessonId:
            value.lessons.find(
              (lesson) =>
                lesson.id === value.activeLessonId && lesson.subjectId === id,
            )?.id ||
            value.lessons.find((lesson) => lesson.subjectId === id)?.id,
        }));
        setView("subject");
        void refresh(id).catch((error) => setToast(String(error)));
      })
      .catch((error) =>
        setToast(
          "The current visual state could not be saved: " + String(error),
        ),
      );
  };
  const createSubject = async (value: {
    name: string;
    objective: string;
    depth: SubjectDepth;
  }) => {
    const created = (await action("subject:create", value)) as Subject;
    openSubject(created.id);
  };
  const createChat = async (node?: CurriculumNode) => {
    if (!subjectId) return;
    const lesson = (await action("subject:conversation-create", {
      subjectId,
      title: node?.title || "New conversation",
      objective:
        node?.description || node?.title || snapshot?.subject.objective || "",
      mode: "Learn",
      curriculumNodeId: node?.id,
    })) as Lesson;
    if (node)
      await action("subject:update", {
        subjectId,
        patch: { currentNodeId: node.id },
      });
    setData((value) => ({
      ...value,
      activeLessonId: lesson.id,
      activeSubjectId: subjectId,
      settings: {
        ...value.settings,
        labOpen: value.settings.visualizationPlacement === "side",
      },
    }));
    setView("workspace");
  };
  const branch = async (messageId: string) => {
    if (!active || !subjectId) return;
    const lesson = (await action("subject:branch", {
      subjectId,
      conversationId: active.id,
      messageId,
      title: active.title + " · branch",
    })) as Lesson;
    setData((value) => ({ ...value, activeLessonId: lesson.id }));
    setView("workspace");
  };
  const request = async (
    instructions: string,
    input: string,
    task: "tutor" | "visual" | "review" = "tutor",
  ) => {
    if (!auth.connected)
      throw new Error(
        "Connect ChatGPT in Settings → Account & models to use this optional learning tool. Your work is saved.",
      );
    const preference = current.current.settings.models[task],
      model =
        models.find((model) => model.id === preference.model) ||
        (preference.model ? undefined : models[0]);
    if (!model)
      throw new Error(
        "The selected model is unavailable. Refresh models in Settings and choose an available model.",
      );
    if (
      preference.reasoning &&
      !model.reasoningLevels.includes(preference.reasoning)
    )
      throw new Error(
        "The selected model no longer supports this reasoning level. Update it in Settings before retrying.",
      );
    await saveQueue.current;
    const sourceStudy = subjectId
      ? await invoke<StudySourceContext>("study-sources:context", {
          subjectId,
          conversationId:
            active?.subjectId === subjectId ? active.id : undefined,
          query: input.slice(0, 2000),
          budget: 1800,
        })
      : null;
    return invoke<string>("model:send", {
      requestId: crypto.randomUUID(),
      model: model.id,
      reasoning: model.reasoningLevels.includes(preference.reasoning)
        ? preference.reasoning
        : undefined,
      instructions: instructions + sourceStudyInstructions(sourceStudy),
      input: [{ role: "user", content: input }],
    });
  };
  const generatePathway = async () => {
    if (!snapshot) return;
    if (!auth.connected)
      throw new Error(
        "Connect ChatGPT in Settings to construct a pathway. Your setup and learning records are saved.",
      );
    const preference = resolvePlanningPreference(
      current.current.settings,
      models,
    );
    await invoke("planning:start", {
      subjectId,
      model: preference.model,
      reasoning: preference.reasoning || undefined,
    });
    setToast(
      "Pathway planning has started. Its saved progress remains visible in your subject and the background task indicator.",
    );
  };
  const onVisualsChange = useCallback((items: VisualInstance[]) => {
    setVisuals(items);
    for (const item of items) {
      if (
        item.subjectId !== subjectIdRef.current ||
        savedTimes.current.get(item.id) === item.updatedAt
      )
        continue;
      savedTimes.current.set(item.id, item.updatedAt);
      pending.current = pending.current
        .catch(() => {})
        .then(async () => {
          const record = await invoke<SubjectRecord>("subject:record-put", {
            subjectId: item.subjectId,
            recordType: "visual",
            id: item.id,
            title: item.title || item.block.type,
            data: item,
            expectedRevision: revisions.current.get(item.id) || 0,
          });
          revisions.current.set(item.id, record.revision);
        })
        .catch((error) => {
          savedTimes.current.delete(item.id);
          setToast("Visual state could not be saved: " + String(error));
        });
    }
  }, []);
  const flush = async () => {
    await flushVisualSources();
    window.dispatchEvent(new Event("studio:flush-visuals"));
    await pending.current;
    await flushCanvasWrites();
  };
  // A confirmed whole-library restore may have older timestamps/revisions than
  // this renderer. Its committed records must replace these caches, rather than
  // entering the ordinary newer-record merge used while a lesson stays live.
  const resetForRestore = () => {
    refreshVersion.current++;
    revisions.current.clear();
    savedTimes.current.clear();
    setSubjects([]);
    setSnapshot(null);
    setVisuals([]);
    setAncestors([]);
    setDocumentId(undefined);
    setPdfUrl(undefined);
    setFocusRecord(undefined);
    setFocusResourceId(undefined);
    setFocusTarget(undefined);
    setExportOpen(false);
    setRestoreGeneration((value) => value + 1);
  };
  const openExport = async (scope: "selection" | "subject") => {
    await flush();
    await saveQueue.current;
    await invoke("data:save", current.current);
    setExportScope(scope);
    setExportOpen(true);
  };
  const chapters = (snapshot?.records || [])
    .filter((record) => record.recordType === "chapter")
    .map(chapterFromRecord);
  const saveChapter = async (
    chapter: TextbookChapter,
    expectedRevision: number,
  ) => {
    const record = (await action("subject:record-put", {
      subjectId: chapter.subjectId,
      recordType: "chapter",
      id: chapter.id,
      title: chapter.title,
      data: chapter,
      expectedRevision,
    })) as SubjectRecord<TextbookChapter>;
    return { ...record.data, revision: record.revision };
  };
  const proposeChapter = async (value: {
    subjectId: string;
    lessonIds: string[];
    instruction: string;
    chapterId?: string;
  }): Promise<ChapterProposal> => {
    const existing = chapters.find((chapter) => chapter.id === value.chapterId),
      selectedLessons = current.current.lessons.filter((lesson) =>
        value.lessonIds.includes(lesson.id),
      );
    if (selectedLessons.length > 30)
      throw new Error(
        "Choose at most 30 source conversations for one coherent chapter. Subject HTML export can include all selected conversations.",
      );
    const lessons = await Promise.all(
      selectedLessons.map(async (lesson) => ({
        ...lesson,
        messages: await invoke<Message[]>("subject:transcript", {
          conversationId: lesson.id,
          limit: 10000,
        }),
      })),
    );
    const raw = await request(
      'Propose a coherent textbook chapter, with explanations, derivations where justified, worked examples and optional exercises. Return JSON {text:"Markdown",blocks:[]}. Preserve the provided user-edited passages; suggest changes for review. Cite only actual supplied source labels. Never invent numerical results or source references.',
      JSON.stringify({
        instruction: value.instruction,
        existing,
        lessons: lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          messages: boundedConversation(
            lesson.messages,
            Math.min(18000, Math.floor(100000 / Math.max(1, lessons.length))),
          ),
          sources: lesson.messages
            .slice(-14)
            .flatMap((message) =>
              (message.sources || []).map((source) => ({
                documentId: source.documentId,
                title: source.title,
                page: source.page,
                citation: source.citation,
              })),
            )
            .slice(0, 6),
        })),
      }),
      "tutor",
    );
    const parsed = parseTutorResponse(raw),
      now = new Date().toISOString();
    return {
      chapter: {
        id: existing?.id || crypto.randomUUID(),
        subjectId: value.subjectId,
        title: existing?.title || lessons[0]?.title || "New chapter",
        markdown: parsed.text,
        blocks: parsed.blocks,
        citations: [
          ...(existing?.citations || []),
          ...lessons
            .flatMap((lesson) =>
              lesson.messages.slice(-14).flatMap((message) =>
                (message.sources || []).map((source) => ({
                  label: source.citation,
                  documentId: source.documentId,
                  page: source.page,
                })),
              ),
            )
            .slice(0, 50),
        ],
        originMessageIds: [
          ...new Set(
            lessons.flatMap((lesson) =>
              lesson.messages.slice(-14).map((message) => message.id),
            ),
          ),
        ],
        revision: existing?.revision || 0,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        position: existing?.position || chapters.length,
        userEdited: false,
      },
      baseRevision: existing?.revision || 0,
      reason: "Proposed from selected conversations. Review before saving.",
    };
  };
  const saveSelectionNote = async (
    text: string,
    title = "Selected explanation",
  ) => {
    if (!subjectId) return;
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    setData((value) => ({
      ...value,
      library: [
        {
          id,
          title,
          kind: "note",
          subject: snapshot?.subject.name || "General",
          subjectId,
          content: text,
          lessonId: active?.id,
          createdAt: now,
        },
        ...value.library,
      ],
    }));
    setToast("Selection saved to subject notes.");
  };
  const insertVisual = async (instance: VisualInstance) => {
    if (!subjectId) return;
    let lesson = active?.subjectId === subjectId ? active : undefined;
    if (!lesson)
      lesson = (await action("subject:conversation-create", {
        subjectId,
        title: "Saved figure discussion",
        mode: "Explore",
      })) as Lesson;
    const target = lesson,
      id = crypto.randomUUID(),
      createdAt = new Date().toISOString();
    setData((value) => ({
      ...value,
      activeLessonId: target.id,
      lessons: value.lessons.map((item) =>
        item.id === target.id
          ? {
              ...item,
              messages: [
                ...item.messages,
                {
                  id,
                  role: "assistant",
                  text: "Saved figure from the subject visual notebook.",
                  blocks: [instance.block],
                  visualInstanceIds: [instance.id],
                  createdAt,
                  status: "complete",
                },
              ],
            }
          : item,
      ),
    }));
    setView("workspace");
  };
  const contextual = async (
    action: string,
    selection: {
      text: string;
      lessonId: string;
      kind: "selection" | "equation";
      messageId?: string;
    },
  ) => {
    const context = subjectId
      ? await invoke("subject:context", {
          subjectId,
          conversationId: active?.id,
          query: selection.text,
          tokenBudget: 1200,
        })
      : undefined;
    const typed = action === "visualize" || action === "practice";
    const base =
      "You provide a temporary contextual explanation without changing the learner’s lesson position. For equations, identify definitions, assumptions, units if applicable, derivation steps, interpretation, limiting cases, and related equations. Clearly distinguish unknown context; do not invent numerical or algebraic results. For challenge/verify, check assumptions and source confidence. Use Markdown and KaTeX notation.";
    const reference = active || {
      id: selection.lessonId,
      title: "Contextual study",
      subject: snapshot?.subject.name || "General",
      subjectId,
      objective:
        snapshot?.subject.objective || "Understand the selected passage",
      mode: "Explore" as const,
      position: "Temporary contextual explanation",
      messages: [],
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const instructions =
      base +
      (typed
        ? "\n" +
          teachingInstructions(reference, current.current.settings, []) +
          "\nFocus exclusively on the selected passage. " +
          (action === "visualize"
            ? "Return a useful actual typed diagram, calculated interactive plot, verified public molecular accession, or sourced image request beside a short explanation."
            : "Return an optional typed exercise with a clear question, hint and answer; include deterministic grading only when justified.")
        : " Return plain Markdown.");
    const raw = await request(
      instructions,
      JSON.stringify({
        action,
        selection,
        objective: active?.objective,
        context,
      }),
      typed ? "visual" : "tutor",
    );
    return parseTutorResponse(raw);
  };
  const navigateSearch = (result: SubjectSearchResult) => {
    if (result.conversationId) {
      setData((value) => ({ ...value, activeLessonId: result.conversationId }));
      setView("workspace");
      if (result.messageId)
        setTimeout(() => {
          const element = document.querySelector(
            '[data-message-id="' + CSS.escape(result.messageId!) + '"]',
          );
          element?.scrollIntoView({ block: "center", behavior: "smooth" });
          element?.classList.add("message-anchor-highlight");
        }, 200);
    } else if (result.recordId) {
      setFocusRecord(result.recordId);
      const record = snapshot?.records.find(
        (record) => record.id === result.recordId,
      );
      setView(
        record?.recordType === "canvas"
          ? "canvas"
          : result.kind === "chapter" || record?.recordType === "chapter"
            ? "textbook"
            : "visuals",
      );
    } else if (result.resourceId) {
      const resource = current.current.library.find(
        (item) => item.id === result.resourceId,
      );
      if (resource?.kind === "document") {
        setDocumentId(result.resourceId);
        setView("documents");
      } else {
        setFocusResourceId(result.resourceId);
        setView("library");
      }
    } else {
      setFocusTarget({
        kind: result.nodeId
          ? "curriculum"
          : result.kind === "concept"
            ? "concept"
            : "memory",
        id: result.nodeId || result.id,
        key: crypto.randomUUID(),
      });
      setView("subject");
    }
  };
  return {
    subjects,
    subjectId,
    snapshot: snapshot?.subject.id === subjectId ? snapshot : null,
    visuals: visuals.filter((item) => item.subjectId === subjectId),
    onVisualsChange,
    flush,
    resetForRestore,
    action,
    refresh,
    openSubject,
    createSubject,
    createChat,
    branch,
    request,
    generatePathway,
    planningPreference: (() => {
      try {
        return resolvePlanningPreference(data.settings, models);
      } catch {
        return undefined;
      }
    })(),
    chapters,
    saveChapter,
    proposeChapter,
    contextual,
    insertVisual,
    saveSelectionNote,
    navigateSearch,
    exportOpen,
    setExportOpen,
    openExport,
    exportScope,
    setExportScope,
    documentId,
    setDocumentId,
    pdfUrl,
    ancestors,
    focusRecord,
    setFocusRecord,
    focusTarget,
    focusResourceId,
    subjectLessons: data.lessons.filter(
      (lesson) =>
        lesson.subjectId === subjectId ||
        snapshot?.conversations.some((chat) => chat.id === lesson.id),
    ),
    subjectDocuments: data.library.filter(
      (item) =>
        item.kind === "document" &&
        (item.subjectId === subjectId ||
          (!item.subjectId &&
            (item.subject || "General") ===
              (snapshot?.subject.name || "General"))),
    ),
  };
}
