import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

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
  const canvasRef = useRef(null);       // drawing layer (top, transparent bg)
  const bgCanvasRef = useRef(null);     // background layer (bottom, white/image)
  const socketRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef(null);
  const localHistoryRef = useRef([]);
  const bgImageRef = useRef(null);      // current background image as base64
  const fileInputRef = useRef(null);

  const toolRef = useRef('pen');
  const colorRef = useRef('#000000');
  const lineWidthRef = useRef(4);

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(4);
  const [connected, setConnected] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [hasBg, setHasBg] = useState(false);

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { lineWidthRef.current = lineWidth; }, [lineWidth]);

  // Render a single stroke segment onto the drawing canvas
  const renderSegment = useCallback((ctx, data) => {
    const { x0, y0, x1, y1, color: c, lineWidth: lw, tool: t } = data;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    if (t === 'eraser') {
      // destination-out makes pixels transparent, revealing the bg canvas below
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = c;
    }
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }, []);

  // Redraw entire drawing layer from local history
  const redrawAll = useCallback((ctx, canvas) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    localHistoryRef.current.forEach((data) => renderSegment(ctx, data));
  }, [renderSegment]);

  // Draw image (or white fill) onto the background canvas
  const drawBgImage = useCallback((base64) => {
    const bgCanvas = bgCanvasRef.current;
    if (!bgCanvas) return;
    const bgCtx = bgCanvas.getContext('2d');
    bgCtx.fillStyle = '#ffffff';
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    if (!base64) return;
    const img = new Image();
    img.onload = () => {
      // Scale to fit while keeping aspect ratio, centered
      const scale = Math.min(bgCanvas.width / img.width, bgCanvas.height / img.height);
      const x = (bgCanvas.width - img.width * scale) / 2;
      const y = (bgCanvas.height - img.height * scale) / 2;
      bgCtx.drawImage(img, x, y, img.width * scale, img.height * scale);
    };
    img.src = base64;
  }, []);

  // Initialize canvases and socket
  useEffect(() => {
    const canvas = canvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    const ctx = canvas.getContext('2d');

    const initCanvases = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      bgCanvas.width = bgCanvas.offsetWidth;
      bgCanvas.height = bgCanvas.offsetHeight;
      const bgCtx = bgCanvas.getContext('2d');
      bgCtx.fillStyle = '#ffffff';
      bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    };
    initCanvases();

    // On resize: resize both canvases and redraw each layer
    const observer = new ResizeObserver(() => {
      bgCanvas.width = bgCanvas.offsetWidth;
      bgCanvas.height = bgCanvas.offsetHeight;
      drawBgImage(bgImageRef.current);

      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      redrawAll(ctx, canvas);
    });
    observer.observe(canvas);

    const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => { setConnected(false); setUserCount(0); });

    socket.on('history', (history) => {
      // Restore most recent background image if present
      const imageEvent = [...history].reverse().find((e) => e.type === 'place_image');
      if (imageEvent) {
        bgImageRef.current = imageEvent.data;
        setHasBg(true);
        drawBgImage(imageEvent.data);
      }
      // Restore drawing history
      localHistoryRef.current = history
        .filter((e) => e.type === 'draw')
        .map(({ x0, y0, x1, y1, color, lineWidth, tool }) => ({ x0, y0, x1, y1, color, lineWidth, tool }));
      redrawAll(ctx, canvas);
    });

    socket.on('draw', (data) => {
      localHistoryRef.current.push(data);
      renderSegment(ctx, data);
    });

    // clear only wipes drawing layer, not background
    socket.on('clear', () => {
      localHistoryRef.current = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    socket.on('place_image', (base64) => {
      bgImageRef.current = base64;
      setHasBg(true);
      drawBgImage(base64);
    });

    socket.on('remove_bg', () => {
      bgImageRef.current = null;
      setHasBg(false);
      const bgCtx = bgCanvas.getContext('2d');
      bgCtx.fillStyle = '#ffffff';
      bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    });

    socket.on('user_count', (count) => setUserCount(count));

    return () => {
      observer.disconnect();
      socket.disconnect();
    };
  }, [renderSegment, redrawAll, drawBgImage]);

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

    localHistoryRef.current.push(data);
    renderSegment(ctx, data);
    socketRef.current?.emit('draw', data);
    lastPoint.current = current;
  }, [renderSegment]);

  const stopDrawing = useCallback((e) => {
    e?.preventDefault();
    isDrawing.current = false;
    lastPoint.current = null;
  }, []);

  // Clears only the drawing layer (background stays)
  const clearBoard = useCallback(() => {
    localHistoryRef.current = [];
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socketRef.current?.emit('clear');
  }, []);

  const handleImageUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result;
      bgImageRef.current = base64;
      setHasBg(true);
      drawBgImage(base64);
      socketRef.current?.emit('place_image', base64);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // allow re-uploading the same file
  }, [drawBgImage]);

  const removeBg = useCallback(() => {
    bgImageRef.current = null;
    setHasBg(false);
    const bgCanvas = bgCanvasRef.current;
    const bgCtx = bgCanvas.getContext('2d');
    bgCtx.fillStyle = '#ffffff';
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    socketRef.current?.emit('remove_bg');
  }, []);

  return (
    <div style={styles.root}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.logo}>Whiteboard</span>

        <div style={styles.separator} />

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
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Custom color"
            style={styles.colorPicker}
          />
        </div>

        <div style={styles.separator} />

        <div style={styles.group}>
          <label style={styles.label}>Size&nbsp;{lineWidth}px</label>
          <input
            type="range" min="1" max="40" value={lineWidth}
            onChange={(e) => setLineWidth(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        <div style={styles.separator} />

        {/* Background image controls */}
        <div style={styles.group}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageUpload}
          />
          <button onClick={() => fileInputRef.current?.click()} style={styles.toolBtn}>
            Image
          </button>
          {hasBg && (
            <button onClick={removeBg} style={{ ...styles.toolBtn, color: '#f38ba8', borderColor: '#f38ba8' }}>
              Remove BG
            </button>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <div style={styles.group}>
          <div style={{ ...styles.dot, background: connected ? '#4ade80' : '#ef4444' }} />
          <span style={{ ...styles.label, color: connected ? '#4ade80' : '#ef4444' }}>
            {connected ? `Online${userCount > 0 ? ` (${userCount})` : ''}` : 'Offline'}
          </span>
        </div>

        <div style={styles.separator} />

        <button onClick={clearBoard} style={styles.clearBtn}>
          Clear
        </button>
      </div>

      {/* Canvas area: bg canvas (bottom) + drawing canvas (top) */}
      <div style={styles.canvasWrapper}>
        <canvas ref={bgCanvasRef} style={styles.bgCanvas} />
        <canvas
          ref={canvasRef}
          style={{ ...styles.drawCanvas, cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
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
  canvasWrapper: {
    flex: 1,
    position: 'relative',
  },
  bgCanvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  drawCanvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    touchAction: 'none',
  },
};
