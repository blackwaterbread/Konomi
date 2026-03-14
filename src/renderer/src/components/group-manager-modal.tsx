import { useEffect, useRef, useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Pencil,
  Check,
  GripVertical,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PromptGroup, PromptToken } from "@preload/index.d";

interface GroupManagerModalProps {
  open: boolean;
  onClose: () => void;
}

function EditableLabel({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing, value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <span
        className={cn(
          "group flex items-center gap-1 cursor-default",
          className,
        )}
        onDoubleClick={() => setEditing(true)}
      >
        {value}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-1", className)}>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        onBlur={commit}
        className="flex-1 min-w-0 bg-background border border-primary/60 rounded px-1.5 py-0.5 text-sm outline-none"
      />
      <button
        type="button"
        onClick={commit}
        className="text-primary hover:text-primary/80"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function TokenRow({
  token,
  onDelete,
}: {
  token: PromptToken;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary/40 group">
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
      <span className="flex-1 text-sm text-foreground/80 min-w-0 truncate">
        {token.label}
      </span>
      <button
        type="button"
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

export function GroupManagerModal({ open, onClose }: GroupManagerModalProps) {
  const [groups, setGroups] = useState<PromptGroup[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const newGroupInputRef = useRef<HTMLInputElement | null>(null);
  const newTokenInputRef = useRef<HTMLInputElement | null>(null);

  const selectedGroup = groups.find((g) => g.id === selectedId) ?? null;

  const reload = async () => {
    setLoading(true);
    try {
      const gs = await window.promptBuilder.listGroups();
      setGroups(gs);
      setSelectedId((prev) => {
        if (prev !== null && gs.some((g) => g.id === prev)) return prev;
        return gs[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void reload();
      setNewGroupName("");
      setNewTokenLabel("");
    }
  }, [open]);

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    const created = await window.promptBuilder.createGroup(name, "user");
    setGroups((prev) => [...prev, created]);
    setSelectedId(created.id);
    setNewGroupName("");
  };

  const handleDeleteGroup = async (id: number) => {
    await window.promptBuilder.deleteGroup(id);
    setConfirmDeleteId(null);
    setGroups((prev) => {
      const next = prev.filter((g) => g.id !== id);
      setSelectedId((sel) => {
        if (sel !== id) return sel;
        return next[0]?.id ?? null;
      });
      return next;
    });
  };

  const handleResetGroups = async () => {
    await window.promptBuilder.resetGroups();
    setConfirmReset(false);
    await reload();
  };

  const handleRenameGroup = async (id: number, name: string) => {
    await window.promptBuilder.renameGroup(id, name);
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  };

  const handleCreateToken = async () => {
    if (!selectedId) return;
    const label = newTokenLabel.trim();
    if (!label) return;
    const token = await window.promptBuilder.createToken(selectedId, label);
    setGroups((prev) =>
      prev.map((g) =>
        g.id === selectedId ? { ...g, tokens: [...g.tokens, token] } : g,
      ),
    );
    setNewTokenLabel("");
    requestAnimationFrame(() => newTokenInputRef.current?.focus());
  };

  const handleDeleteToken = async (groupId: number, tokenId: number) => {
    await window.promptBuilder.deleteToken(tokenId);
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, tokens: g.tokens.filter((t) => t.id !== tokenId) }
          : g,
      ),
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-[640px] max-h-[60vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">그룹 관리</h2>
          <div className="flex items-center gap-1">
            {confirmReset ? (
              <div className="flex items-center gap-1.5 mr-2">
                <span className="text-xs text-muted-foreground">
                  초기값으로 초기화할까요?
                </span>
                <button
                  type="button"
                  onClick={() => void handleResetGroups()}
                  className="h-7 px-2.5 rounded text-xs bg-destructive/15 border border-destructive/30 text-destructive hover:bg-destructive/25 transition-colors"
                >
                  초기화
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="h-7 px-2 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="h-7 px-2.5 flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="초기값으로 초기화"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                초기화
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: group list */}
          <div className="w-48 shrink-0 border-r border-border flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto py-2">
              {loading ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  로딩 중...
                </p>
              ) : groups.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  그룹 없음
                </p>
              ) : (
                groups.map((g) => (
                  <div
                    key={g.id}
                    onClick={() => {
                      setSelectedId(g.id);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 cursor-pointer group",
                      selectedId === g.id
                        ? "bg-primary/10 text-primary"
                        : "text-foreground/80 hover:bg-secondary/50",
                    )}
                  >
                    <span className="flex-1 text-sm truncate min-w-0">
                      {g.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(g.id);
                        setSelectedId(g.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* New group input */}
            <div className="border-t border-border p-2">
              <div className="flex gap-1">
                <input
                  ref={newGroupInputRef}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateGroup();
                    }
                  }}
                  placeholder="그룹 이름..."
                  className="flex-1 min-w-0 h-7 px-2 text-xs bg-secondary/60 border border-border/60 rounded outline-none focus:border-primary/60 text-foreground placeholder:text-muted-foreground/40"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateGroup()}
                  disabled={!newGroupName.trim()}
                  className="h-7 w-7 flex items-center justify-center rounded bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Right: token list */}
          <div className="flex-1 min-w-0 flex flex-col">
            {!selectedGroup ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground/50">
                  그룹을 선택하세요
                </p>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-border shrink-0">
                  <EditableLabel
                    value={selectedGroup.name}
                    onSave={(name) =>
                      void handleRenameGroup(selectedGroup.id, name)
                    }
                    className="text-sm font-medium text-foreground"
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedGroup.tokens.length}개 토큰
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto py-2 px-2">
                  {selectedGroup.tokens.length === 0 ? (
                    <p className="text-xs text-muted-foreground/50 text-center py-6">
                      토큰 없음 — 아래에서 추가하세요
                    </p>
                  ) : (
                    selectedGroup.tokens.map((t) => (
                      <TokenRow
                        key={t.id}
                        token={t}
                        onDelete={() =>
                          void handleDeleteToken(selectedGroup.id, t.id)
                        }
                      />
                    ))
                  )}
                </div>

                {/* New token input */}
                <div className="border-t border-border p-3">
                  <div className="flex gap-1.5">
                    <input
                      ref={newTokenInputRef}
                      value={newTokenLabel}
                      onChange={(e) => setNewTokenLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleCreateToken();
                        }
                      }}
                      placeholder="태그 추가..."
                      className="flex-1 min-w-0 h-8 px-2.5 text-sm bg-secondary/60 border border-border/60 rounded-lg outline-none focus:border-primary/60 text-foreground placeholder:text-muted-foreground/40"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCreateToken()}
                      disabled={!newTokenLabel.trim()}
                      className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-primary/15 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/25 transition-colors disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      추가
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDeleteId !== null &&
        (() => {
          const target = groups.find((g) => g.id === confirmDeleteId);
          return (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl">
              <div
                className="absolute inset-0 bg-black/40 rounded-xl"
                onClick={() => setConfirmDeleteId(null)}
              />
              <div className="relative z-10 mx-6 w-full max-w-xs rounded-lg border border-border bg-background shadow-xl p-4 flex flex-col gap-3">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{target?.name}</span> 그룹을
                  삭제할까요?
                </p>
                <p className="text-xs text-muted-foreground">
                  그룹에 속한 토큰도 함께 삭제됩니다.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="h-7 px-3 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteGroup(confirmDeleteId)}
                    className="h-7 px-3 rounded text-xs bg-destructive/15 border border-destructive/30 text-destructive hover:bg-destructive/25 transition-colors"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
