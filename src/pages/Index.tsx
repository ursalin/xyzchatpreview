import { useState } from 'react';
import { ChatContainer } from '@/components/chat/ChatContainer';
import Live2DPanel from '@/components/live2d/Live2DPanel';
import { useSettings } from '@/hooks/useSettings';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeft } from 'lucide-react';

const Index = () => {
  const { settings } = useSettings();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mood, setMood] = useState<'happy' | 'neutral' | 'thinking'>('neutral');
  const [showAvatar, setShowAvatar] = useState(true);

  return (
    <div className="h-screen w-full flex bg-background">
      {/* Live2D Avatar Panel */}
      {showAvatar && (
        <div className="hidden md:flex w-1/2 lg:w-[45%] p-4 relative">
          <Live2DPanel isSpeaking={isSpeaking} />
        </div>
      )}
      
      {/* Chat Panel */}
      <div className={`flex-1 flex flex-col relative ${showAvatar ? '' : 'max-w-4xl mx-auto w-full'}`}>
        {/* Toggle Avatar Button (Desktop) */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3 left-3 z-50 hidden md:flex"
          onClick={() => setShowAvatar(!showAvatar)}
        >
          {showAvatar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </Button>
        
        <ChatContainer 
          onSpeakingChange={setIsSpeaking}
          onMoodChange={setMood}
        />
      </div>
      
      {/* Mobile Avatar (shows at top on mobile) */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-[200px] z-0">
        <Live2DPanel isSpeaking={isSpeaking} />
      </div>
    </div>
  );
};

export default Index;
