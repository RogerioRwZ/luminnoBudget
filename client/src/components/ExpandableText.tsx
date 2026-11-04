import { useLayoutEffect, useRef, useState } from "react";

// Texto longo em poucas linhas, com "Ver mais". O botão só aparece se o texto
// realmente não couber, conferido de novo quando a largura muda.
export function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);
  return (
    <div className={className}>
      <p ref={ref} className={`whitespace-pre-line break-words text-xs text-muted-foreground ${expanded ? "" : "line-clamp-3"}`}>
        {text}
      </p>
      {overflows || expanded ? (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(current => !current)} className="-ml-1 rounded px-1 py-1 text-xs font-semibold text-primary hover:underline">
          {expanded ? "Ver menos" : "Ver mais"}
        </button>
      ) : null}
    </div>
  );
}
