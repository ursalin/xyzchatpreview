import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import lockscreenImg from '@/assets/lockscreen.jpg';

const UNLOCKED_KEY = 'app-unlocked';

const LockScreen = () => {
  const navigate = useNavigate();
  const [unlocking, setUnlocking] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // 更新时间
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 3秒后显示提示
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleUnlock = (e: React.MouseEvent<HTMLDivElement>) => {
    if (unlocking) return;
    
    // 获取点击位置的百分比
    const rect = e.currentTarget.getBoundingClientRect();
    const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((e.clientY - rect.top) / rect.height) * 100;

    // 苹果大致在底部中间：x 35-65%, y 75-95%
    const isAppleArea = xPercent > 25 && xPercent < 75 && yPercent > 70 && yPercent < 98;

    // 设置涟漪效果位置
    setRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (isAppleArea) {
      setUnlocking(true);
      // 存储解锁状态
      sessionStorage.setItem(UNLOCKED_KEY, 'true');
      // 延迟导航，让动画播放
      setTimeout(() => {
        navigate('/home');
      }, 800);
    } else {
      // 非目标区域点击：显示提示
      setShowHint(true);
      // 涟漪消散
      setTimeout(() => setRipple(null), 600);
    }
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
      onClick={handleUnlock}
    >
      {/* 背景图 + 动效 */}
      <div 
        className={`absolute inset-0 transition-all duration-700 ${
          unlocking ? 'scale-110 blur-sm opacity-0' : ''
        }`}
      >
        <img
          src={lockscreenImg}
          alt="Lock Screen"
          className="w-full h-full object-cover"
          style={{
            animation: 'lockscreen-drift 20s ease-in-out infinite',
          }}
        />
        
        {/* 光效叠加 */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, transparent 30%, rgba(255,200,100,0.08) 50%, transparent 70%)',
            animation: 'light-sweep 8s ease-in-out infinite',
          }}
        />
        
        {/* 顶部渐变（让文字更清晰） */}
        <div className="absolute top-0 left-0 right-0 h-48 bg-gradient-to-b from-black/40 to-transparent" />
        
        {/* 底部渐变 */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/50 to-transparent" />
      </div>

      {/* 涟漪效果 */}
      {ripple && (
        <div
          className="absolute rounded-full border-2 border-white/40 pointer-events-none"
          style={{
            left: ripple.x - 40,
            top: ripple.y - 40,
            width: 80,
            height: 80,
            animation: 'ripple-expand 0.6s ease-out forwards',
          }}
        />
      )}

      {/* 时间显示 */}
      <div className={`absolute top-16 left-0 right-0 text-center transition-all duration-700 ${
        unlocking ? '-translate-y-20 opacity-0' : ''
      }`}>
        <div className="text-white text-7xl font-thin tracking-wider drop-shadow-lg"
          style={{ fontFamily: '-apple-system, "Helvetica Neue", sans-serif' }}
        >
          {timeStr}
        </div>
        <div className="text-white/80 text-lg mt-2 drop-shadow-md">
          {dateStr}
        </div>
      </div>

      {/* 解锁提示 */}
      <div className={`absolute bottom-20 left-0 right-0 text-center transition-all duration-500 ${
        unlocking ? 'translate-y-10 opacity-0' : ''
      } ${showHint ? 'opacity-100' : 'opacity-0'}`}>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/30 backdrop-blur-sm">
          <span className="text-white/90 text-sm">
            轻触苹果解锁 🍎
          </span>
        </div>
        <div className="mt-3">
          <div 
            className="w-1 h-1 bg-white/60 rounded-full mx-auto"
            style={{ animation: 'bounce-dot 2s ease-in-out infinite' }}
          />
        </div>
      </div>

      {/* 解锁成功动画 */}
      {unlocking && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div 
            className="w-20 h-20 rounded-full border-2 border-white/60 flex items-center justify-center"
            style={{ animation: 'unlock-ring 0.6s ease-out forwards' }}
          >
            <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12l5 5L20 7" style={{ animation: 'draw-check 0.4s ease-out 0.2s forwards', strokeDasharray: 30, strokeDashoffset: 30 }} />
            </svg>
          </div>
        </div>
      )}

      <style>{`
        @keyframes lockscreen-drift {
          0%, 100% { transform: scale(1.02) translate(0, 0); }
          25% { transform: scale(1.04) translate(-0.5%, -0.3%); }
          50% { transform: scale(1.03) translate(0.3%, 0.5%); }
          75% { transform: scale(1.05) translate(0.5%, -0.2%); }
        }
        @keyframes light-sweep {
          0%, 100% { opacity: 0; transform: translateX(-100%); }
          50% { opacity: 1; transform: translateX(100%); }
        }
        @keyframes ripple-expand {
          0% { transform: scale(0.5); opacity: 1; }
          100% { transform: scale(3); opacity: 0; }
        }
        @keyframes bounce-dot {
          0%, 100% { transform: translateY(0); opacity: 0.6; }
          50% { transform: translateY(8px); opacity: 1; }
        }
        @keyframes unlock-ring {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes draw-check {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
};

export default LockScreen;
