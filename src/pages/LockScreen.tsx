import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import lockscreenImg from '@/assets/lockscreen.jpg';

const LockScreen = () => {
  const navigate = useNavigate();
  const [unlocking, setUnlocking] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const touchStartY = useRef<number | null>(null);

  // 更新时间
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 2秒后显示提示
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const doUnlock = () => {
    if (unlocking) return;
    setUnlocking(true);
    setTimeout(() => navigate('/home'), 800);
  };

  // 上滑解锁
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    touchStartY.current = null;
    // 上滑超过 80px 解锁
    if (deltaY > 80) {
      doUnlock();
    }
  };

  // 点击也可以解锁
  const handleClick = () => {
    doUnlock();
  };

  const timeStr = currentTime.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const dateStr = currentTime.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <div 
      className="fixed inset-0 z-50 cursor-pointer select-none overflow-hidden"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 背景图 + 动效 */}
      <div 
        className={`absolute inset-0 transition-all duration-700 ease-out ${
          unlocking ? 'scale-110 opacity-0' : ''
        }`}
      >
        <img
          src={lockscreenImg}
          alt="Lock Screen"
          className="w-full h-full object-cover"
          style={{
            animation: 'lockscreen-drift 25s ease-in-out infinite',
          }}
        />
        
        {/* 海面波光效果 */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, transparent 50%, rgba(255,150,50,0.06) 70%, rgba(255,100,0,0.08) 85%, transparent 100%)',
            animation: 'ocean-shimmer 4s ease-in-out infinite',
          }}
        />

        {/* 顶部渐变 */}
        <div className="absolute top-0 left-0 right-0 h-52 bg-gradient-to-b from-black/30 to-transparent" />
        
        {/* 底部渐变 */}
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black/40 to-transparent" />
      </div>

      {/* 时间显示 */}
      <div className={`absolute top-16 left-0 right-0 text-center transition-all duration-700 ${
        unlocking ? '-translate-y-20 opacity-0' : ''
      }`}>
        <div 
          className="text-white text-7xl font-extralight tracking-widest drop-shadow-lg"
          style={{ fontFamily: '-apple-system, "Helvetica Neue", sans-serif' }}
        >
          {timeStr}
        </div>
        <div className="text-white/70 text-base mt-2 font-light tracking-wide drop-shadow-md">
          {dateStr}
        </div>
      </div>

      {/* 解锁提示 */}
      <div className={`absolute bottom-16 left-0 right-0 text-center transition-all duration-500 ${
        unlocking ? 'translate-y-10 opacity-0' : ''
      } ${showHint ? 'opacity-100' : 'opacity-0'}`}>
        <div className="text-white/70 text-sm font-light tracking-wider"
          style={{ animation: 'fade-pulse 3s ease-in-out infinite' }}
        >
          上滑或轻触解锁
        </div>
        <div className="mt-4 flex justify-center">
          <div 
            className="w-10 h-1 rounded-full bg-white/40"
            style={{ animation: 'swipe-hint 2s ease-in-out infinite' }}
          />
        </div>
      </div>

      {/* 解锁成功 - 白色闪光 */}
      {unlocking && (
        <div 
          className="absolute inset-0 bg-white"
          style={{ animation: 'flash-in 0.6s ease-out forwards' }}
        />
      )}

      <style>{`
        @keyframes lockscreen-drift {
          0%, 100% { transform: scale(1.03); }
          33% { transform: scale(1.06) translate(-0.3%, -0.2%); }
          66% { transform: scale(1.04) translate(0.2%, 0.3%); }
        }
        @keyframes ocean-shimmer {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.8; }
        }
        @keyframes fade-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes swipe-hint {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-6px); opacity: 0.8; }
        }
        @keyframes flash-in {
          0% { opacity: 0; }
          40% { opacity: 1; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default LockScreen;
