import { useState } from "react";
import { AspectRatioPicker } from "./AspectRatioPicker";
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from "../lib/constants";

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  width: number;
  height: number;
}

interface ProjectManagerDialogProps {
  projects: ProjectSummary[];
  currentProjectId: string;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCreate: (name: string, width: number, height: number, presetId: string) => void;
  onClose: () => void;
}

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ProjectManagerDialog({
  projects,
  currentProjectId,
  onOpen,
  onRename,
  onDelete,
  onCreate,
  onClose,
}: ProjectManagerDialogProps) {
  const [mode, setMode] = useState<"list" | "create">("list");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newName, setNewName] = useState("Untitled project");
  const [newSize, setNewSize] = useState({ width: DEFAULT_PROJECT_WIDTH, height: DEFAULT_PROJECT_HEIGHT });
  const [newPresetId, setNewPresetId] = useState("x-16-9");

  function startRename(p: ProjectSummary) {
    setRenamingId(p.id);
    setRenameValue(p.name);
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-large" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <i className="ri-folder-open-line" aria-hidden="true" />
          <span>{mode === "list" ? "Your projects" : "New project"}</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body">
          {mode === "list" ? (
            <>
              <button type="button" className="btn btn-primary project-new-btn" onClick={() => setMode("create")}>
                <i className="ri-add-line" aria-hidden="true" />
                <span>New project</span>
              </button>
              <div className="project-list">
                {projects.map((p) => (
                  <div className={"project-row" + (p.id === currentProjectId ? " is-current" : "")} key={p.id}>
                    <button type="button" className="project-row-main" onClick={() => onOpen(p.id)}>
                      <i className="ri-clapperboard-line" aria-hidden="true" />
                      <span className="project-row-info">
                        {renamingId === p.id ? (
                          <input
                            type="text"
                            className="project-rename-input"
                            value={renameValue}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                          />
                        ) : (
                          <span className="project-row-name">{p.name}</span>
                        )}
                        <span className="project-row-meta">
                          {p.width}×{p.height} · {relativeTime(p.updatedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="project-row-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(p);
                      }}
                      data-tip="Rename"
                      aria-label="Rename project"
                    >
                      <i className="ri-edit-line" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="project-row-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(p.id);
                      }}
                      data-tip="Delete"
                      aria-label="Delete project"
                    >
                      <i className="ri-delete-bin-line" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <label className="project-name-field">
                <span>Project name</span>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              </label>
              <AspectRatioPicker
                width={newSize.width}
                height={newSize.height}
                onSelect={(w, h, presetId) => {
                  setNewSize({ width: w, height: h });
                  setNewPresetId(presetId);
                }}
              />
            </>
          )}
        </div>

        <div className="modal-foot">
          {mode === "create" && (
            <>
              <button type="button" className="btn" onClick={() => setMode("list")}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onCreate(newName.trim() || "Untitled project", newSize.width, newSize.height, newPresetId)}
              >
                <i className="ri-add-line" aria-hidden="true" />
                <span>Create</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
