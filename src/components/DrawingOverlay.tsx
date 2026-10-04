import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";

interface Props {
  targetRef: React.RefObject<HTMLElement>; // область, поверх которой рисуем (текст + картинки)
  onAttach: (canvas: HTMLCanvasElement) => void;
  onClose: () => void;
}

const PEN_COLORS = ["#1B2340", "#FF6B5B", "#6B9080", "#FFC93C", "#5AA9E6"];
type Tool = "pencil" | "eraser";

export default function DrawingOverlay({ targetRef, onAttach, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [brushSize, setBrushSize] = useState(3);
  const [drawing, setDrawing] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Небольшая панель, которую можно перетащить в любое свободное место листа
  const [toolbarPos, setToolbarPos] = useState({ x: 8, y: 8 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setSize({ width: rect.width, height: Math.max(rect.height, 400) });
  }, [targetRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    canvas.style.width = size.width + "px";
    canvas.style.height = size.height + "px";
    canvas.getContext("2d")?.scale(ratio, ratio);
  }, [size]);

  // Перетаскивание панели инструментов
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      const st = dragState.current;
      if (!st) return;
      setToolbarPos({ x: st.origX + (e.clientX - st.startX), y: st.origY + (e.clientY - st.startY) });
    }
    function onUp() {
      setDragging(false);
      dragState.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  // Pointer-события вместо mouse — одинаково работают с мышью, пальцем и стилусом
  function startDragToolbar(e: React.PointerEvent<HTMLDivElement>) {
    // Двигаем панель, если тянут за её фон, а не за кнопку/слайдер внутри — иначе клики бы не работали
    const target = e.target as HTMLElement;
    if (target.closest("button, input")) return;
    e.preventDefault();
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: toolbarPos.x, origY: toolbarPos.y };
    setDragging(true);
  }

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    // Захват указателя: линия продолжается, даже если палец/мышь вышли за край холста
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(true);
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = brushSize * 6;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
    }
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDraw() {
    setDrawing(false);
  }

  function handleClear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const ratio = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
  }

  async function handleScreenshot() {
    const target = targetRef.current;
    const overlay = canvasRef.current;
    if (!target || !overlay) return;
    const base = await html2canvas(target, { backgroundColor: "#ffffff", useCORS: true });
    const ctx = base.getContext("2d")!;
    ctx.drawImage(overlay, 0, 0, base.width, base.height);
    onAttach(base);
  }

  return (
    <div className="absolute inset-0 z-30" style={{ width: size.width, height: size.height }}>
      <div
        onPointerDown={startDragToolbar}
        className="absolute z-10 flex flex-wrap items-center gap-1.5 bg-ink/90 backdrop-blur rounded-card px-1.5 py-1 shadow-lg select-none cursor-grab touch-none max-w-[calc(100%-16px)]"
        style={{ left: toolbarPos.x, top: toolbarPos.y, cursor: dragging ? "grabbing" : "grab" }}
      >
        <span className="text-white/60 px-1 text-sm leading-none" title="Перетащить панель">
          ⠿
        </span>

        <div className="flex items-center gap-0.5 bg-white/10 rounded-card p-0.5">
          <button
            onClick={() => setTool("pencil")}
            className={`px-1.5 py-1 rounded-card text-[11px] text-white ${tool === "pencil" ? "bg-white/20 font-medium" : "opacity-60"}`}
          >
            ✏️
          </button>
          <button
            onClick={() => setTool("eraser")}
            className={`px-1.5 py-1 rounded-card text-[11px] text-white ${tool === "eraser" ? "bg-white/20 font-medium" : "opacity-60"}`}
          >
            🧽
          </button>
        </div>

        {tool === "pencil" && (
          <div className="flex items-center gap-1">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-3.5 h-3.5 rounded-full border ${color === c ? "border-white" : "border-white/30"}`}
                style={{ backgroundColor: c }}
                aria-label={`Цвет пера ${c}`}
              />
            ))}
          </div>
        )}

        <input
          type="range"
          min={1}
          max={10}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="w-12"
        />

        <button onClick={handleClear} className="text-[11px] text-white/70 hover:text-white px-1" title="Очистить">
          🗑️
        </button>
        <button onClick={handleScreenshot} className="text-[11px] rounded-card bg-highlight text-ink font-medium px-2 py-1" title="Сделать снимок и прикрепить">
          📸
        </button>
        <button onClick={onClose} className="text-[11px] text-white/70 hover:text-white px-1" title="Закрыть рисование">
          ✕
        </button>
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={startDraw}
        onPointerMove={draw}
        onPointerUp={stopDraw}
        onPointerCancel={stopDraw}
        className="absolute inset-0 cursor-crosshair touch-none"
      />
    </div>
  );
}
