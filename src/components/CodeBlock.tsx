import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { lad, scl, stl } from "../features/editor/languages";
import { useSettings } from "../state/settings";
import { CopyButton } from "./CopyButton";

/** Affichage du code en lecture seule, avec la même coloration que l'éditeur. */
export function CodeBlock({
  code,
  title,
  language,
}: {
  code: string;
  title: string;
  language: "scl" | "lad" | "stl";
}) {
  const theme = useSettings((s) => s.theme);
  const extensions = useMemo(
    () => [{ scl, lad, stl }[language](), EditorView.editable.of(false)],
    [language],
  );
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-3 py-2">
        <span className="font-mono text-xs text-slate-400">{title}</span>
        <CopyButton text={code} />
      </div>
      <div className="text-[13px]">
        <CodeMirror
          value={code.replace(/\n$/, "")}
          extensions={extensions}
          theme={theme === "light" ? "light" : oneDark}
          readOnly
          basicSetup={{ foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
        />
      </div>
    </div>
  );
}
