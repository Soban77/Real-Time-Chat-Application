import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  DrawingTool,
  Point,
  WhiteboardDrawStep,
  WhiteboardStroke,
  useWhiteboardSync,
} from '../hooks/useWhiteboardSync';

const TOOLS: DrawingTool[] = ['pen', 'eraser', 'rectangle', 'circle', 'line'];
const DEFAULT_COLOR = '#111827';
const DEFAULT_STROKE_WIDTH = 3;

interface WhiteboardCanvasProps {
  socket: Socket | null;
  roomId: string;
  userId: string;
  className?: string;
}

function toNormalizedPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  };
}

function denormalizePoint(point: Point, width: number, height: number): Point {
  return {
    x: point.x * width,
    y: point.y * height,
  };
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: WhiteboardStroke,
  width: number,
  height: number
): void {
  if (stroke.points.length === 0) {
    return;
  }

  const points = stroke.points.map((point) => denormalizePoint(point, width, height));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.strokeWidth;

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }

  if (stroke.tool === 'pen' || stroke.tool === 'eraser') {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
  } else if (stroke.tool === 'line' && points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
  } else if (stroke.tool === 'rectangle' && points.length >= 2) {
    const [start, end] = points;
    const rectWidth = end.x - start.x;
    const rectHeight = end.y - start.y;
    ctx.strokeRect(start.x, start.y, rectWidth, rectHeight);
  } else if (stroke.tool === 'circle' && points.length >= 2) {
    const [center, edge] = points;
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function renderStrokes(
  canvas: HTMLCanvasElement,
  strokes: WhiteboardStroke[],
  width: number,
  height: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  for (const stroke of strokes) {
    drawStroke(ctx, stroke, width, height);
  }
}

function createStrokeId(): string {
  return crypto.randomUUID();
}

export function WhiteboardCanvas({ socket, roomId, userId, className }: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeStrokeRef = useRef<{
    strokeId: string;
    startPoint: Point;
  } | null>(null);

  const [tool, setTool] = useState<DrawingTool>('pen');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE_WIDTH);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const { strokes, applyLocalStep, emitDrawStep, clearCanvas } = useWhiteboardSync({
    socket,
    roomId,
    userId,
  });

  const publishStep = useCallback(
    (step: WhiteboardDrawStep) => {
      applyLocalStep(step);
      emitDrawStep(step);
    },
    [applyLocalStep, emitDrawStep]
  );

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) {
      return;
    }

    const width = container.clientWidth;
    const height = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // setCanvasSize({ width, height });
    setCanvasSize((prev) => {
      if (prev.width === width && prev.height === height) {
        return prev;
      }
      return { width, height };
    });

    renderStrokes(canvas, strokes, width, height);
  }, [strokes]);

  useEffect(() => {
    resizeCanvas();
    const observer = new ResizeObserver(() => {
      resizeCanvas();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [resizeCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) {
      return;
    }

    renderStrokes(canvas, strokes, canvasSize.width, canvasSize.height);
  }, [canvasSize.height, canvasSize.width, strokes]);

  const buildStep = useCallback(
    (
      strokeId: string,
      pointOrPoints: Point | Point[],
      isComplete: boolean
    ): WhiteboardDrawStep => {
      const base: WhiteboardDrawStep = {
        strokeId,
        userId,
        tool,
        color: tool === 'eraser' ? '#000000' : color,
        strokeWidth: tool === 'eraser' ? strokeWidth * 2 : strokeWidth,
        isComplete,
        timestamp: Date.now(),
      };

      if (tool === 'pen' || tool === 'eraser') {
        return {
          ...base,
          point: pointOrPoints as Point,
        };
      }

      return {
        ...base,
        points: pointOrPoints as Point[],
      };
    },
    [color, strokeWidth, tool, userId]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toNormalizedPoint(canvas, event.clientX, event.clientY);
    const strokeId = createStrokeId();

    activeStrokeRef.current = { strokeId, startPoint: point };
    setIsDrawing(true);

    if (tool === 'pen' || tool === 'eraser') {
      publishStep(buildStep(strokeId, point, false));
    } else {
      publishStep(buildStep(strokeId, [point, point], false));
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !activeStrokeRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const point = toNormalizedPoint(canvas, event.clientX, event.clientY);
    const { strokeId, startPoint } = activeStrokeRef.current;

    if (tool === 'pen' || tool === 'eraser') {
      publishStep(buildStep(strokeId, point, false));
      return;
    }

    publishStep(buildStep(strokeId, [startPoint, point], false));
  };

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !activeStrokeRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const point = toNormalizedPoint(canvas, event.clientX, event.clientY);
    const { strokeId, startPoint } = activeStrokeRef.current;

    if (tool === 'pen' || tool === 'eraser') {
      publishStep(buildStep(strokeId, point, true));
    } else {
      publishStep(buildStep(strokeId, [startPoint, point], true));
    }

    activeStrokeRef.current = null;
    setIsDrawing(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleClear = () => {
    activeStrokeRef.current = null;
    setIsDrawing(false);
    clearCanvas();
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          padding: 8,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#f9fafb',
        }}
      >
        {TOOLS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTool(entry)}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: tool === entry ? '1px solid #3b82f6' : '1px solid #334155',
              background: tool === entry ? '#1e3a8a' : '#1e293b',
              color: tool === entry ? '#ffffff' : '#94a3b8',
              fontWeight: tool === entry ? '600' : '500',
              fontSize: '14px',
              cursor: 'pointer',
              textTransform: 'capitalize',
              transition: 'all 0.15s ease-in-out',
              boxShadow: tool === entry ? '0 0 12px rgba(59, 130, 246, 0.35)' : 'none',
            }}
          >
            {entry}
          </button>
        ))}

        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: '13px',
          fontWeight: 500,
          color: tool === 'eraser' ? '#64748b' : '#cbd5e1',
          cursor: tool === 'eraser' ? 'not-allowed' : 'pointer',
          userSelect: 'none',
        }}>
          Color
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              disabled={tool === 'eraser'}
              style={{
                width: 28,
                height: 28,
                padding: 0,
                border: '2px solid #475569',
                borderRadius: '50%',
                backgroundColor: 'transparent',
                cursor: tool === 'eraser' ? 'not-allowed' : 'pointer',
                opacity: tool === 'eraser' ? 0.4 : 1,
                outline: 'none',
                WebkitAppearance: 'none',
              }}
            />
          </div>
        </label>

        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: '13px',
          fontWeight: 500,
          color: '#cbd5e1',
          userSelect: 'none',
        }}>
          Width
          <input
            type="range"
            min={1}
            max={24}
            value={strokeWidth}
            onChange={(event) => setStrokeWidth(Number(event.target.value))}
          />
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#3b82f6',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              padding: '2px 6px',
              borderRadius: '4px',
              minWidth: '32px',
              textAlign: 'center',
            }}
          >{strokeWidth}px</span>
        </label>

        <button
          type="button"
          onClick={handleClear}
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #fca5a5',
            background: '#fee2e2',
            color: '#991b1b',
            cursor: 'pointer',
          }}
        >
          Clear Canvas
        </button>
      </div>

      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: 480,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#ffffff',
          touchAction: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerLeave={finishStroke}
          onPointerCancel={finishStroke}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            cursor: 'crosshair',
          }}
        />
      </div>
    </div >
  );
}
