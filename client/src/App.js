import React, { useState, useEffect, useRef } from 'react';
import Swal from 'sweetalert2';
import 'bootstrap/dist/css/bootstrap.min.css';
import useWebSocket from './hooks/useWebSocket';

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResults, setShowResults] = useState(false);
  const playerRef = useRef(null);
  const [isYTReady, setIsYTReady] = useState(false);
  const isSkippingRef = useRef(false);
  const isManualSkipRef = useRef(false);
  const isLoadingNewVideoRef = useRef(false);
  const currentVideoIdRef = useRef(null);

  const baseURL = 'http://192.168.20.111:5000';
  const wsURL = 'ws://192.168.20.111:5000';

  const { isConnected: isWsConnected, sendMessage } = useWebSocket(wsURL, (data) => {
    if (data.type === 'queue_updated') {
      fetchQueue();
    }
  });

    const [isMobile, setIsMobile] = useState(false);

useEffect(() => {
  const checkMobile = () => {
    setIsMobile(window.innerWidth < 768);
  };

  checkMobile();
  window.addEventListener('resize', checkMobile);

  return () => window.removeEventListener('resize', checkMobile);
}, []);

  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setIsYTReady(true);
      return;
    }

    window.onYouTubeIframeAPIReady = () => {
      setIsYTReady(true);
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  }, []);
const removeSong = async (videoId) => {
  try {
    const res = await fetch(`${baseURL}/api/remove?videoId=${videoId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  } catch (err) {
    console.error('removeSong error:', err);
  }
};
  const fetchQueue = async () => {
  try {
    const res = await fetch(`${baseURL}/api/queue`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    const newQueue = data.queue || [];

    setQueue((prevQueue) => {
      const isChanged =
        prevQueue.length !== newQueue.length ||
        prevQueue.some((item, index) => item.videoId !== newQueue[index]?.videoId);

      if (isChanged) {
        // ถ้า queue เปลี่ยน และไม่ได้เล่นอะไร ให้เริ่มเล่นอัตโนมัติ
        if (!isMobile && playerRef.current) {
          const state = playerRef.current.getPlayerState?.();
          if (state === -1 || state === window.YT.PlayerState.ENDED || state === undefined) {
            const nextVideoId = newQueue[currentIndex]?.videoId;
            if (nextVideoId) {
              console.log("🔁 โหลดเพลงใหม่อัตโนมัติจาก queue update:", nextVideoId);
              playerRef.current.loadVideoById(nextVideoId);
            }
          }
        }
      }

      return isChanged ? newQueue : prevQueue;
    });
  } catch (err) {
    setError(`เชื่อมต่อกับเซิร์ฟเวอร์ไม่ได้: ${err.message}`);
  }
};

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${baseURL}/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      setResults(data.results || []);
      setShowResults(true);
    } catch (err) {
      setError(`ค้นหาไม่สำเร็จ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const addSong = async (video) => {
    const result = await Swal.fire({
      title: `เพิ่มเพลง "${video.title}" เข้าคิว?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'เพิ่ม',
      cancelButtonText: 'ยกเลิก',
    });

    if (result.isConfirmed) {
      try {
        const res = await fetch(`${baseURL}/api/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(video),
        });

        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        sendMessage({ type: 'add_song', song: video });

        setShowResults(false);
        Swal.fire('เพิ่มสำเร็จ!', '', 'success');
      } catch (err) {
        setError(`เพิ่มเพลงไม่สำเร็จ: ${err.message}`);
      }
    }
  };

const autoNextSong = async () => {
  const currentVideoId = queue[currentIndex]?.videoId;
  if (!currentVideoId) return;

  // ลบเพลงเก่าออกจากฐานข้อมูล
  await removeSong(currentVideoId);

  // ข้ามไปยังเพลงถัดไป
  setCurrentIndex((prevIndex) => {
    const nextIndex = prevIndex + 1;
    if (nextIndex < queue.length) {
      console.log('เปลี่ยนเพลงไปที่ index', nextIndex);
      return nextIndex;
    } else {
      console.log('หมดคิวเพลง');
      return prevIndex; // หรือ 0 ถ้าคุณอยากเริ่มใหม่
    }
  });

  // ให้ server อัปเดต queue ให้ client ทันที (optional)
  sendMessage({ type: 'song_removed', videoId: currentVideoId });
};
const skipSong = async () => {
  if (queue.length === 0 || isSkippingRef.current) return;

  const result = await Swal.fire({
    title: 'คุณแน่ใจว่าจะข้ามเพลงนี้?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ข้าม',
    cancelButtonText: 'ยกเลิก',
  });

  if (result.isConfirmed) {
    isSkippingRef.current = true;
    isManualSkipRef.current = true;

    try {
      // ข้ามเพลงโดยเพิ่ม currentIndex ทันที
      setCurrentIndex((prevIndex) => {
        const nextIndex = prevIndex + 1;
        return nextIndex < queue.length ? nextIndex : 0; // ถ้าถึงสุด ให้วนกลับไปเพลงแรก
      });

      // สั่งลบเพลงที่ข้ามออกจาก queue (ถ้าต้องการ)
      const currentVideoId = queue[currentIndex]?.videoId;
      if (currentVideoId) {
        await removeSong(currentVideoId);
      }

      Swal.fire('ข้ามเพลงแล้ว', '', 'success');
    } catch (err) {
      console.error('skipSong error:', err);
      Swal.fire('เกิดข้อผิดพลาด', '', 'error');
    } finally {
      isSkippingRef.current = false;
      isManualSkipRef.current = false;
    }
  }
};

useEffect(() => {
  if (isMobile || !window.YT || queue.length === 0) return;

  const currentVideoId = queue[currentIndex]?.videoId;
  console.log('useEffect currentVideoId:', currentVideoId);

  if (!playerRef.current) {
    playerRef.current = new window.YT.Player('yt-player', {
      videoId: currentVideoId,
      width: '100%',
      height: '600',
      events: {
        onReady: () => console.log('Player พร้อมแล้ว'),
        onStateChange: (event) => {
          if (event.data === window.YT.PlayerState.ENDED) {
            autoNextSong();
          }
        },
      },
    });
  } else {
    const currentPlayerVideoId = playerRef.current.getVideoData()?.video_id;
    if (currentPlayerVideoId !== currentVideoId) {
      playerRef.current.loadVideoById(currentVideoId);
    }
  }
}, [queue, currentIndex, isMobile]);




  useEffect(() => {
    if (isWsConnected) {
      fetchQueue();
    }
  }, [isWsConnected]);

  return (
    <div className="container py-4 card rounded" style={{ backgroundColor: '#121212', minHeight: '100vh', color: '#eee' }}>
      <h1 className="mb-4 text-center">🎵 คิวเพลงแบบ Real-time</h1>

      <div className="mb-2">
        {isWsConnected ? (
          <span className="text-success">● เชื่อมต่อเซิร์ฟเวอร์แล้ว</span>
        ) : (
          <span className="text-danger">● กำลังเชื่อมต่อเซิร์ฟเวอร์...</span>
        )}
      </div>

      <div className="input-group mb-3">
        <input
          type="text"
          className="form-control"
          placeholder="ค้นหาเพลง YouTube..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-primary" onClick={handleSearch} disabled={loading}>
          {loading ? 'กำลังค้นหา...' : 'ค้นหา'}
        </button>
      </div>

      {showResults && results.length > 0 && (
        <div className="list-group mb-4 ">
          {results.map((video, index) => (
            <button
              key={index}
              className="list-group-item list-group-item-action d-flex align-items-center"
              onClick={() => addSong(video)}
            >
              <img src={video.thumbnail} alt="" width={60} className="me-2" />
              {video.title}
            </button>
          ))}
        </div>
      )}

      <h3>🎧 คิวเพลง</h3>
      <ul className="list-group mb-3">
        {queue.map((song, index) => (
          <li
            key={index}
            className={`list-group-item d-flex justify-content-between align-items-center ${
              index === currentIndex ? 'active bg-success text-white' : ''
            }`}
          >
            {song.title}
          </li>
        ))}
      </ul>

{!isMobile && (
  <div id="yt-player" className="mb-4" />
)}

      <div className="text-center">
        <button className="btn btn-warning" onClick={skipSong}>
          ⏭ ข้ามเพลง
        </button>
      </div>
    </div>
  );
}

export default App;
