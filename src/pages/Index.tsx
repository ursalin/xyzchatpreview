import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatContainer } from '@/components/chat/ChatContainer';
import Live2DPanel from '@/components/live2d/Live2DPanel';
import { useSettings } from '@/hooks/useSettings';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeft, Video, Phone } from 'lucide-react';

const Index = () => {
  const { settings } = useSettings();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mood, setMood] = useState<'happy' | 'neutral' | 'thinking'>('neutral');
  const [showAvatar, setShowAvatar] = useState(true);

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-background">
      {/* Mobile: Top Navigation Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 py-2 bg-background/95 backdrop-blur-sm border-b safe-area-top">
        <Link to="/video-call">
          <Button variant="outline" size="icon" className="h-9 w-9">
            <Video className="w-4 h-4" />
          </Button>
        </Link>
        <span className="text-sm font-medium">{settings.character.name}</span>
        <Link to="/realtime-call">
          <Button variant="default" size="icon" className="h-9 w-9">
            <Phone className="w-4 h-4" />
          </Button>
        </Link>
      </div>

      {/* Mobile: Avatar Area (below nav bar) */}
      <div className="md:hidden w-full h-[35vh] min-h-[200px] max-h-[280px] mt-[52px] flex-shrink-0">
        <Live2DPanel isSpeaking={isSpeaking} />
      </div>

      {/* Desktop: Live2D Avatar Panel (left side) */}
      {showAvatar && (
        <div className="hidden md:flex w-1/2 lg:w-[45%] p-4 relative">
          <Live2DPanel isSpeaking={isSpeaking} />
        </div>
      )}
      
      {/* Chat Panel */}
      <div className={`flex-1 flex flex-col relative min-h-0 ${showAvatar ? '' : 'max-w-4xl mx-auto w-full'}`}>
        {/* Desktop: Top Controls */}
        <div className="hidden md:flex absolute top-3 left-3 z-50 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowAvatar(!showAvatar)}
          >
            {showAvatar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </Button>
          
          <Link to="/video-call">
            <Button variant="outline" size="sm" className="gap-2">
              <Video className="w-4 h-4" />
              视频通话
            </Button>
          </Link>

          <Link to="/realtime-call">
            <Button variant="default" size="sm" className="gap-2">
              <Phone className="w-4 h-4" />
              实时语音
            </Button>
          </Link>
        </div>
        
        <ChatContainer 
          onSpeakingChange={setIsSpeaking}
          onMoodChange={setMood}
        />
      </div>
    </div>
  );
};

export default Index;
