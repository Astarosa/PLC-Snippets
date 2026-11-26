import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { useSettings } from "../../state/settings";
import { lad, scl, stl } from "./languages";

const LANGUAGES = { scl, lad, stl, markdown: () => markdown() };

export function CodeEditor({
  value,
  onChange,
  language,
  minHeight = "200px",
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  language: keyof typeof LANGUAGES;
  minHeight?: string;
  placeholder?: string;
}) {
  const extensions = useMemo(() => [LANGUAGES[language]()], [language]);
  const theme = useSettings((st) => st.theme);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700 text-[13px]">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={theme === "light" ? "light" : oneDark}
        minHeight={minHeight}
        placeholder={placeholder}
        basicSetup={{ foldGutter: false, highlightActiveLine: true, tabSize: 4 }}
        indentWithTab
      />
    </div>
  );
}
