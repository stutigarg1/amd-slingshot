import React, { useState, useRef, useEffect } from 'react';
import { Upload, X, Image as ImageIcon, Film, Wand2, Loader2, Mic, MicOff } from 'lucide-react';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { ai, MODELS, SYSTEM_INSTRUCTIONS } from './lib/gemini';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

interface Message {
  role: 'user' | 'model';
  text: string;
  image?: string;
}

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: "Welcome to DreamAbode. I'm your personal interior design assistant. Upload a photo of your room to get started, or just tell me what you're looking for!" }
  ]);
  const [activeTab, setActiveTab] = useState<'chat' | 'generate' | 'video'>('chat');
  const [isLiveActive, setIsLiveActive] = useState(false);
  
  // Refs for Live API
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const liveSessionRef = useRef<any>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        // Switch to generate tab automatically when image is uploaded
        setActiveTab('generate');
        addMessage('user', 'I uploaded a room image.', reader.result as string);
        addMessage('model', 'Great! I see your room. What would you like to change? I can suggest a new style, add specific furniture, or we can just chat about it.');
      };
      reader.readAsDataURL(file);
    }
  };

  const addMessage = (role: 'user' | 'model', text: string, img?: string) => {
    setMessages(prev => [...prev, { role, text, image: img }]);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() && !image) return;

    const userMsg = chatInput;
    setChatInput('');
    addMessage('user', userMsg);
    setIsGenerating(true);

    try {
      // If we have an image and the user is asking for a visual change (simple heuristic or explicit mode)
      // For now, we'll keep the chat text-based unless they use the "Generate" tab tools.
      // But we can pass the image context to the chat model.
      
      const parts: any[] = [{ text: userMsg }];
      if (image) {
        // Strip base64 prefix
        const base64Data = image.split(',')[1];
        parts.unshift({
          inlineData: {
            mimeType: 'image/jpeg', // Assuming jpeg for simplicity, but should detect
            data: base64Data
          }
        });
      }

      const response = await ai.models.generateContent({
        model: MODELS.TEXT_CHAT,
        contents: {
          parts: parts
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTIONS.DESIGNER
        }
      });

      const text = response.text;
      if (text) {
        addMessage('model', text);
      }
    } catch (error) {
      console.error("Chat error:", error);
      addMessage('model', "I'm having trouble connecting right now. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateImage = async (prompt: string) => {
    if (!image) return;
    setIsGenerating(true);
    setGeneratedImage(null);

    try {
      const base64Data = image.split(',')[1];
      const response = await ai.models.generateContent({
        model: MODELS.IMAGE_EDIT,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data
              }
            },
            { text: prompt }
          ]
        }
      });

      // Extract image
      let foundImage = false;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const imgUrl = `data:image/png;base64,${part.inlineData.data}`;
            setGeneratedImage(imgUrl);
            foundImage = true;
            addMessage('model', `Here is a generated idea based on "${prompt}":`, imgUrl);
          }
        }
      }
      
      if (!foundImage) {
        addMessage('model', "I couldn't generate an image this time. Please try a different prompt.");
      }

    } catch (error) {
      console.error("Image gen error:", error);
      addMessage('model', "Sorry, I encountered an error generating the image.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!image && !generatedImage) return;
    const sourceImage = generatedImage || image;
    if (!sourceImage) return;

    setIsGenerating(true);
    setGeneratedVideo(null);
    addMessage('model', "I'm generating a 3D walkthrough video for you. This may take a moment...");

    try {
      const base64Data = sourceImage.split(',')[1];
      
      let operation = await ai.models.generateVideos({
        model: MODELS.VIDEO_GEN,
        prompt: "A cinematic slow pan walkthrough of this room, high quality, photorealistic, 4k",
        image: {
          imageBytes: base64Data,
          mimeType: 'image/png', // Assuming png from generation or jpeg from upload
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      // Poll
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({operation: operation});
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (videoUri) {
        // Fetch with API key
        const vidResponse = await fetch(videoUri, {
            headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY! }
        });
        const blob = await vidResponse.blob();
        const url = URL.createObjectURL(blob);
        setGeneratedVideo(url);
        addMessage('model', "Here is your 3D walkthrough video!");
      } else {
        addMessage('model', "Video generation failed to return a URI.");
      }

    } catch (error) {
      console.error("Video gen error:", error);
      addMessage('model', "Sorry, I encountered an error generating the video.");
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Live API Implementation ---

  const startLiveSession = async () => {
    try {
      setIsLiveActive(true);
      
      // 1. Setup Audio Context
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });

      // 2. Get Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      mediaStreamRef.current = stream;

      // 3. Connect to Gemini Live
      const session = await ai.live.connect({
        model: MODELS.LIVE_AUDIO,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: SYSTEM_INSTRUCTIONS.DESIGNER,
        },
        callbacks: {
          onopen: async () => {
            console.log("Live session connected");
            
            if (audioContextRef.current?.state === 'suspended') {
              await audioContextRef.current.resume();
            }

            // Start processing audio
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert float32 to int16 PCM
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              
              // Base64 encode
              const base64Audio = btoa(
                String.fromCharCode(...new Uint8Array(pcmData.buffer))
              );
              
              session.sendRealtimeInput({
                media: {
                  mimeType: "audio/pcm;rate=16000",
                  data: base64Audio
                }
              });
            };
            
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);
            processorRef.current = processor;
          },
          onmessage: (msg: LiveServerMessage) => {
            // Handle interruption
            if (msg.serverContent?.interrupted) {
              console.log("Interrupted");
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              // Ideally cancel current source, but for simplicity we just clear queue
              return;
            }

            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              playAudioChunk(audioData);
            }
          },
          onclose: () => {
            console.log("Live session closed");
            stopLiveSession();
          },
          onerror: (err) => {
            console.error("Live session error:", err);
            stopLiveSession();
          }
        }
      });
      
      liveSessionRef.current = session;

    } catch (error) {
      console.error("Failed to start live session:", error);
      setIsLiveActive(false);
    }
  };

  const stopLiveSession = () => {
    setIsLiveActive(false);
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Note: The SDK doesn't expose a clean 'close' method on the session promise result directly in all versions,
    // but usually closing the socket is handled by the server or network drop. 
    // We just clean up client side here.
    liveSessionRef.current = null;
  };

  const playAudioChunk = async (base64Audio: string) => {
    // Simple queue implementation
    audioQueueRef.current.push(base64Audio);
    if (!isPlayingRef.current) {
      processAudioQueue();
    }
  };

  const processAudioQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    
    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift();
    
    if (chunk && audioContextRef.current) {
      try {
        // Decode base64 to array buffer
        const binaryString = atob(chunk);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // For raw PCM, we need to manually create a buffer or use a wav header.
        // The model returns PCM 24kHz usually.
        // Let's try to decode assuming it's a supported format or raw.
        // Actually, the Live API returns PCM. Web Audio API decodeAudioData expects a container (WAV/MP3).
        // We need to construct a buffer manually for PCM.
        
        // Assuming 24kHz output from Gemini Live (standard)
        const sampleRate = 24000; 
        const float32 = new Float32Array(bytes.length / 2);
        const dataView = new DataView(bytes.buffer);
        
        for (let i = 0; i < bytes.length / 2; i++) {
           const int16 = dataView.getInt16(i * 2, true); // Little endian
           float32[i] = int16 / 32768;
        }
        
        const audioBuffer = audioContextRef.current.createBuffer(1, float32.length, sampleRate);
        audioBuffer.getChannelData(0).set(float32);
        
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.start();
        
        source.onended = () => {
          processAudioQueue();
        };
        
      } catch (e) {
        console.error("Audio playback error", e);
        processAudioQueue();
      }
    } else {
        processAudioQueue();
    }
  };


  return (
    <div className="min-h-screen flex flex-col font-sans text-ink bg-cream">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-olive/10 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-olive flex items-center justify-center text-white">
            <Wand2 size={18} />
          </div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">DreamAbode</h1>
        </div>
        <div className="flex items-center gap-4">
           {isLiveActive ? (
             <Button variant="primary" onClick={stopLiveSession} className="bg-red-500 hover:bg-red-600 animate-pulse">
               <MicOff size={18} className="mr-2" /> End Voice Chat
             </Button>
           ) : (
             <Button variant="outline" onClick={startLiveSession}>
               <Mic size={18} className="mr-2" /> Voice Chat
             </Button>
           )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden h-[calc(100vh-73px)]">
        
        {/* Left Panel: Visual Workspace */}
        <div className="flex-1 p-6 overflow-y-auto border-r border-olive/10 bg-white/30">
          <div className="max-w-3xl mx-auto space-y-6">
            
            {/* Upload Area */}
            {!image ? (
              <Card 
                className="border-2 border-dashed border-olive/20 bg-white/50 h-96 flex flex-col items-center justify-center cursor-pointer hover:bg-white/80 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-16 h-16 rounded-full bg-olive/10 flex items-center justify-center mb-4 text-olive">
                  <Upload size={32} />
                </div>
                <h3 className="font-serif text-2xl text-olive mb-2">Upload your room</h3>
                <p className="text-olive/60 font-sans">Click to browse or drag and drop</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*"
                  onChange={handleImageUpload}
                />
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Main Image Display */}
                <div className="relative group rounded-3xl overflow-hidden shadow-lg">
                  <img src={generatedImage || image} alt="Room" className="w-full h-auto object-cover" />
                  <div className="absolute top-4 right-4 flex gap-2">
                    <Button 
                      size="sm" 
                      variant="secondary" 
                      onClick={() => {
                        setGeneratedImage(null);
                        setGeneratedVideo(null);
                      }}
                      className="bg-white/90 backdrop-blur"
                    >
                      <X size={14} className="mr-1" /> Reset
                    </Button>
                  </div>
                  
                  {/* Quick Actions Overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-center gap-3">
                    <Button 
                        variant="secondary" 
                        className="bg-white/90 text-ink border-none"
                        onClick={() => handleGenerateImage("Make it Mid-Century Modern style")}
                    >
                        Mid-Century
                    </Button>
                    <Button 
                        variant="secondary" 
                        className="bg-white/90 text-ink border-none"
                        onClick={() => handleGenerateImage("Make it Minimalist Scandinavian")}
                    >
                        Scandinavian
                    </Button>
                    <Button 
                        variant="secondary" 
                        className="bg-white/90 text-ink border-none"
                        onClick={() => handleGenerateImage("Add many indoor plants and warm lighting")}
                    >
                        Bohemian
                    </Button>
                  </div>
                </div>

                {/* Video Result */}
                {generatedVideo && (
                  <Card className="p-4">
                    <h3 className="font-serif text-lg mb-3 flex items-center gap-2">
                        <Film size={18} /> 3D Walkthrough
                    </h3>
                    <video controls autoPlay loop className="w-full rounded-2xl">
                        <source src={generatedVideo} type="video/mp4" />
                        Your browser does not support the video tag.
                    </video>
                  </Card>
                )}

                {/* Tools Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setActiveTab('generate')}>
                        <div className="flex items-center gap-3 mb-2 text-olive">
                            <ImageIcon size={20} />
                            <h3 className="font-medium">Generate Ideas</h3>
                        </div>
                        <p className="text-sm text-olive/60">Explore different styles and layouts for your room.</p>
                    </Card>
                    <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer" onClick={handleGenerateVideo}>
                        <div className="flex items-center gap-3 mb-2 text-olive">
                            <Film size={20} />
                            <h3 className="font-medium">Create Walkthrough</h3>
                        </div>
                        <p className="text-sm text-olive/60">Turn your design into an immersive 3D video.</p>
                    </Card>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Chat / Controls */}
        <div className="w-full lg:w-[400px] bg-white border-l border-olive/10 flex flex-col">
          
          {/* Tabs */}
          <div className="flex border-b border-olive/10">
            <button 
                className={cn("flex-1 py-4 text-sm font-medium transition-colors", activeTab === 'chat' ? "text-olive border-b-2 border-olive" : "text-olive/50 hover:text-olive/80")}
                onClick={() => setActiveTab('chat')}
            >
                Designer Chat
            </button>
            <button 
                className={cn("flex-1 py-4 text-sm font-medium transition-colors", activeTab === 'generate' ? "text-olive border-b-2 border-olive" : "text-olive/50 hover:text-olive/80")}
                onClick={() => setActiveTab('generate')}
            >
                Edit & Style
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide">
            {activeTab === 'chat' ? (
                <div className="space-y-4">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                            <div className={cn(
                                "max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed",
                                msg.role === 'user' 
                                    ? "bg-olive text-white rounded-br-none" 
                                    : "bg-cream text-ink rounded-bl-none"
                            )}>
                                {msg.image && (
                                    <img src={msg.image} alt="Context" className="rounded-lg mb-2 max-w-full" />
                                )}
                                <ReactMarkdown>{msg.text}</ReactMarkdown>
                            </div>
                        </div>
                    ))}
                    {isGenerating && (
                        <div className="flex justify-start">
                            <div className="bg-cream rounded-2xl p-4 rounded-bl-none flex items-center gap-2">
                                <Loader2 size={16} className="animate-spin text-olive" />
                                <span className="text-xs text-olive/70">Thinking...</span>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>
            ) : (
                <div className="space-y-6">
                    <div>
                        <h3 className="font-serif text-lg mb-2">Custom Transformation</h3>
                        <p className="text-sm text-olive/60 mb-4">Describe exactly what you want to change about the room.</p>
                        <textarea 
                            className="w-full p-3 rounded-xl border border-olive/20 bg-cream text-sm focus:outline-none focus:ring-2 focus:ring-olive/50 min-h-[100px]"
                            placeholder="e.g., Change the wall color to sage green and add a leather armchair..."
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                        />
                        <Button 
                            className="w-full mt-3" 
                            onClick={() => {
                                handleGenerateImage(chatInput);
                                setChatInput('');
                            }}
                            disabled={!image || !chatInput.trim() || isGenerating}
                        >
                            {isGenerating ? <Loader2 className="animate-spin" /> : <Wand2 size={16} className="mr-2" />}
                            Generate
                        </Button>
                    </div>

                    <div className="border-t border-olive/10 pt-6">
                        <h3 className="font-serif text-lg mb-4">Preset Styles</h3>
                        <div className="grid grid-cols-2 gap-3">
                            {['Modern', 'Industrial', 'Coastal', 'Rustic', 'Art Deco', 'Zen'].map(style => (
                                <Button 
                                    key={style} 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => handleGenerateImage(`Transform this room into ${style} style`)}
                                    disabled={!image || isGenerating}
                                >
                                    {style}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
          </div>

          {/* Input Area (only for chat tab) */}
          {activeTab === 'chat' && (
            <div className="p-4 border-t border-olive/10 bg-white">
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        className="flex-1 bg-cream rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-olive/50"
                        placeholder="Ask for design advice..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    />
                    <Button size="icon" onClick={handleSendMessage} disabled={!chatInput.trim() && !image}>
                        <Wand2 size={18} />
                    </Button>
                </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
