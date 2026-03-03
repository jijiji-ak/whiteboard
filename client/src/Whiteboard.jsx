import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Preset colors for quick access
const PRESET_COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#3b82f6', '#a855f7',
  '#ec4899', '#6b7280',
];

const TOOLS = [
  { id: 'pen', label: 'Pen' },
  { id: 'eraser', label: 'Eraser' },
];

function getEventPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches?.[0] ?? e;
  return {
    x: (touch.clientX - rect.left) * (canvas.width / rect.width),
    y: (touch.clientY - rect.top) * (canvas.height / rect.height),
  };
}

export default function Whiteboard() {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef(null);

  // Use refs for values accessed inside event handlers to avoid stale closures
  const toolRef = useRef('pen');
  const colorRef = useRef('#000000');
  const lineWidthRef = useRef(4);

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(4);
  const [connected, setConnected] = useState(false);
  const [userCount, setUserCount] = useState(0);

  // Keep refs in sync with state
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { lineWidthRef.current = lineWidth; }, [lineWidth]);

  const renderSegment = useCallback((ctx, data) => {
    const { x0, y0, x1, y1, color: c, lineWidth: lw, tool: t } = data;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = t === 'eraser' ? '#ffffff' : c;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, []);

  // Initialize canvas size and socket connection
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const initCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    initCanvas();

    // Preserve drawing content on window resize
    const observer = new ResizeObserver(() => {
      const saved = ctx.getImageData(0, 0, canvas.width, canvas.height);
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(saved, 0, 0);
    });
    observer.observe(canvas);

    // Connect to server
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => { setConnected(false); setUserCount(0); });

    // Redraw full history when first joining
    socket.on('history', (history) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      history.forEach((event) => {
        if (event.type === 'draw') renderSegment(ctx, event);
      });
    });

    socket.on('draw', (data) => renderSegment(ctx, data));

    socket.on('clear', () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('user_count', (count) => setUserCount(count));

    return () => {
      observer.disconnect();
      socket.disconnect();
    };
  }, [renderSegment]);

  const startDrawing = useCallback((e) => {
    e.preventDefault();
    isDrawing.current = true;
    lastPoint.current = getEventPos(e, canvasRef.current);
  }, []);

  const draw = useCallback((e) => {
    e.preventDefault();
    if (!isDrawing.current || !lastPoint.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const current = getEventPos(e, canvas);
    const isEraser = toolRef.current === 'eraser';

    const data = {
      x0: lastPoint.current.x,
      y0: lastPoint.current.y,
      x1: current.x,
      y1: current.y,
      color: colorRef.current,
      lineWidth: isEraser ? lineWidthRef.current * 6 : lineWidthRef.current,
      tool: toolRef.current,
    };

    renderSegment(ctx, data);
    socketRef.current?.emit('draw', data);
    lastPoint.current = current;
  }, [renderSegment]);

  const stopDrawing = useCallback((e) => {
    e?.preventDefault();
    isDrawing.current = false;
    lastPoint.current = null;
  }, []);

  const clearBoard = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    socketRef.current?.emit('clear');
  }, []);

  return (
    <div style={styles.root}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.logo}>Whiteboard</span>

        <div style={styles.separator} />

        {/* Tool selector */}
        <div style={styles.group}>
          {TOOLS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              style={{ ...styles.toolBtn, ...(tool === id ? styles.toolBtnActive : {}) }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={styles.separator} />

        {/* Preset colors */}
        <div style={styles.group}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{
                ...styles.colorSwatch,
                background: c,
                border: color === c ? '2px solid #4ade80' : '2px solid #555',
                outline: c === '#ffffff' ? '1px solid #aaa' : 'none',
              }}
            />
          ))}
          {/* Custom color picker */}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Custom color"
            style={styles.colorPicker}
          />
        </div>

        <div style={styles.separator} />

        {/* Stroke size */}
        <div style={styles.group}>
          <label style={styles.label}>Size&nbsp;{lineWidth}px</label>
          <input
            type="range"
            min="1"
            max="40"
            value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        <div style={{ flex: 1 }} />

        {/* Connection status */}
        <div style={styles.group}>
          <div
            style={{
              ...styles.dot,
              background: connected ? '#4ade80' : '#ef4444',
            }}
          />
          <span style={{ ...styles.label, color: connected ? '#4ade80' : '#ef4444' }}>
            {connected ? `Online${userCount > 0 ? ` (${userCount})` : ''}` : 'Offline'}
          </span>
        </div>

        <div style={styles.separator} />

        <button onClick={clearBoard} style={styles.clearBtn}>
          Clear
        </button>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          ...styles.canvas,
          cursor: tool === 'eraser' ? 'cell' : 'crosshair',
        }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        onTouchCancel={stopDrawing}
      />
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 14px',
    background: '#1e1e2e',
    color: '#cdd6f4',
    flexWrap: 'wrap',
    minHeight: '50px',
    userSelect: 'none',
  },
  logo: {
    fontWeight: 700,
    fontSize: '16px',
    color: '#cba6f7',
    letterSpacing: '0.5px',
  },
  separator: {
    width: '1px',
    height: '24px',
    background: '#45475a',
    flexShrink: 0,
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  toolBtn: {
    background: '#313244',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    padding: '5px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'all 0.1s',
  },
  toolBtnActive: {
    background: '#cba6f7',
    color: '#1e1e2e',
    borderColor: '#cba6f7',
    fontWeight: 600,
  },
  colorSwatch: {
    width: '22px',
    height: '22px',
    borderRadius: '4px',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  colorPicker: {
    width: '28px',
    height: '28px',
    border: '2px solid #555',
    borderRadius: '4px',
    padding: '1px',
    background: 'none',
    cursor: 'pointer',
  },
  label: {
    fontSize: '12px',
    color: '#a6adc8',
    whiteSpace: 'nowrap',
  },
  slider: {
    width: '90px',
    accentColor: '#cba6f7',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  clearBtn: {
    background: '#f38ba8',
    color: '#1e1e2e',
    border: 'none',
    padding: '5px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  canvas: {
    flex: 1,
    display: 'block',
    touchAction: 'none',
  },
};
