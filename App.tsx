import React, { useState, useRef, useEffect } from 'react';
import { AppState, TargetLanguage, LANGUAGE_LABELS } from './types';
import { translateSafetyText, generateSpeech, extractTextFromFile } from './services/geminiService';
import { isValidFileType, isValidFileSize, MAX_FILE_SIZE_MB } from './services/fileUtils';
import { 
  Megaphone, 
  Languages, 
  Play, 
  Pause,
  Square, 
  AlertTriangle, 
  Loader2, 
  Volume2,
  HardHat,
  Upload,
  FileText,
  X,
  VolumeX
} from 'lucide-react';

const MAX_INPUT_LENGTH = 10000; // Limit input characters to prevent timeouts

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    inputText: '',
    selectedLanguage: TargetLanguage.CHINESE,
    isProcessing: false,
    result: null,
    error: null,
  });

  const [isExtracting, setIsExtracting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  // Audio context refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize AudioContext lazily (browsers block autoplay if created too early without interaction)
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000 // Match Gemini TTS output
      });
    }
    return audioContextRef.current;
  };

  const handleTranslateAndSpeak = async () => {
    if (!state.inputText.trim()) {
      setState(prev => ({ ...prev, error: '안전교육 내용을 입력해주세요.' }));
      return;
    }

    if (state.inputText.length > MAX_INPUT_LENGTH) {
       setState(prev => ({ 
           ...prev, 
           error: `입력 텍스트가 너무 깁니다 (${state.inputText.length.toLocaleString()}자). 원활한 통역을 위해 ${MAX_INPUT_LENGTH.toLocaleString()}자 이내로 줄여주세요.` 
       }));
       return;
    }

    setState(prev => ({ ...prev, isProcessing: true, error: null, result: null }));
    stopAudio(); // Ensure clean state

    try {
      // 1. Translate first
      const translatedText = await translateSafetyText(state.inputText, state.selectedLanguage);
      
      // Update state with translation result immediately
      setState(prev => ({
        ...prev,
        result: {
          originalText: state.inputText,
          translatedText: translatedText,
          targetLanguage: state.selectedLanguage,
          audioBuffer: null // No audio yet
        }
      }));

      // 2. Generate Speech (in parallel with UI update effectively)
      // We keep isProcessing true until audio is ready or failed
      
      try {
        const audioCtx = getAudioContext();
        const audioBuffer = await generateSpeech(translatedText, audioCtx);

        setState(prev => ({
            ...prev,
            isProcessing: false,
            result: prev.result ? { ...prev.result, audioBuffer } : null
        }));

        // Auto-play only if successful
        await playAudio(audioBuffer, audioCtx);

      } catch (audioErr: any) {
        console.error("Audio Generation failed:", audioErr);
        // Don't clear the result, just stop processing and show warning
        setState(prev => ({
            ...prev,
            isProcessing: false,
            error: `번역은 완료되었으나 음성 생성에 실패했습니다: ${audioErr.message}`
        }));
      }

    } catch (err: any) {
      setState(prev => ({ 
        ...prev, 
        isProcessing: false, 
        error: err.message || '처리 중 오류가 발생했습니다.' 
      }));
    }
  };

  const playAudio = async (buffer: AudioBuffer, ctx: AudioContext) => {
    // Ensure existing audio is stopped and context is ready
    stopAudio();
    
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    source.onended = () => {
      // Natural end of playback
      setIsPlaying(false);
      setIsPaused(false);
    };

    source.start();
    audioSourceRef.current = source;
    setIsPlaying(true);
    setIsPaused(false);
  };

  const handlePause = async () => {
    if (audioContextRef.current && isPlaying) {
      await audioContextRef.current.suspend();
      setIsPlaying(false);
      setIsPaused(true);
    }
  };

  const handleResume = async () => {
    if (audioContextRef.current && isPaused) {
      await audioContextRef.current.resume();
      setIsPlaying(true);
      setIsPaused(false);
    }
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try {
        // Remove onended to prevent state update race conditions
        audioSourceRef.current.onended = null;
        audioSourceRef.current.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
      audioSourceRef.current = null;
    }
    
    // Always resume context on stop so it's ready for next play
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
    }

    setIsPlaying(false);
    setIsPaused(false);
  };

  const handleReplay = () => {
    if (state.result?.audioBuffer && audioContextRef.current) {
      playAudio(state.result.audioBuffer, audioContextRef.current);
    }
  };

  // --- File Upload Handlers ---

  const handleFile = async (file: File) => {
    if (!isValidFileType(file)) {
      setState(prev => ({ ...prev, error: '지원되지 않는 파일 형식입니다. (docx, xlsx, pptx, hwp, pdf, txt 사용 가능)' }));
      return;
    }

    if (!isValidFileSize(file)) {
      setState(prev => ({ ...prev, error: `파일 크기는 ${MAX_FILE_SIZE_MB}MB 이하여야 합니다.` }));
      return;
    }

    setIsExtracting(true);
    setState(prev => ({ ...prev, error: null, result: null }));

    try {
      const extracted = await extractTextFromFile(file);
      if (extracted.length > MAX_INPUT_LENGTH) {
          setState(prev => ({
              ...prev,
              inputText: extracted.slice(0, MAX_INPUT_LENGTH),
              error: `파일 내용이 너무 길어 앞부분 ${MAX_INPUT_LENGTH.toLocaleString()}자만 불러왔습니다.`
          }));
      } else {
          setState(prev => ({
              ...prev,
              inputText: extracted,
          }));
      }
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        error: err.message || '파일 읽기 실패'
      }));
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
    // Reset value to allow selecting the same file again if needed
    if (e.target.value) e.target.value = '';
  };

  const clearInput = () => {
    setState(prev => ({ ...prev, inputText: '', result: null }));
  };


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-slate-900 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 caution-stripe"></div>
        <div className="container mx-auto px-4 py-6 flex items-center justify-between z-10 relative">
          <div className="flex items-center space-x-3">
            <div className="bg-yellow-500 p-2 rounded-lg text-slate-900">
              <HardHat size={32} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Safety<span className="text-yellow-500">Speak</span>
              </h1>
              <p className="text-slate-400 text-sm">건설현장 다국어 안전교육 통역기</p>
            </div>
          </div>
          <div className="hidden md:flex items-center space-x-2 text-yellow-500 text-sm font-semibold uppercase tracking-wider border border-yellow-500/30 px-3 py-1 rounded bg-yellow-500/10">
            <AlertTriangle size={16} />
            <span>Safety First</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow container mx-auto px-4 py-8 max-w-4xl">
        
        {/* Input Section */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-8">
          <div className="bg-slate-100 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-700 flex items-center">
              <Megaphone className="mr-2 text-blue-600" size={20} />
              안전교육 내용 (텍스트 또는 파일)
            </h2>
            <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-500 font-medium">KOREAN INPUT</span>
                {state.inputText && (
                    <button onClick={clearInput} className="text-slate-400 hover:text-red-500 transition-colors">
                        <X size={18} />
                    </button>
                )}
            </div>
          </div>
          
          <div className="p-6">
            {/* File Upload Area */}
            <div 
                className={`mb-4 border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center transition-all cursor-pointer relative ${
                    dragActive 
                        ? 'border-blue-500 bg-blue-50' 
                        : isExtracting 
                            ? 'border-slate-200 bg-slate-50' 
                            : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => !isExtracting && fileInputRef.current?.click()}
            >
                <input 
                    ref={fileInputRef}
                    type="file" 
                    className="hidden" 
                    accept=".docx,.xlsx,.pptx,.hwp,.txt,.pdf"
                    onChange={onFileSelect}
                />
                
                {isExtracting ? (
                    <div className="flex flex-col items-center py-2">
                        <Loader2 className="animate-spin text-blue-600 mb-2" size={32} />
                        <p className="text-slate-600 font-medium">파일 내용을 읽어오는 중입니다...</p>
                        <p className="text-xs text-slate-400 mt-1">AI가 문서를 분석하고 있습니다.</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center py-1 group">
                        <div className="bg-slate-100 p-3 rounded-full mb-3 group-hover:bg-blue-100 transition-colors">
                            <Upload className="text-slate-500 group-hover:text-blue-600" size={24} />
                        </div>
                        <p className="text-slate-700 font-medium mb-1">
                            파일을 클릭하거나 여기로 드래그하세요
                        </p>
                        <p className="text-xs text-slate-500">
                            지원 형식: DOCX, XLSX, PPTX, HWP, PDF, TXT (최대 {MAX_FILE_SIZE_MB}MB)
                        </p>
                    </div>
                )}
            </div>

            <div className="relative">
                <textarea 
                value={state.inputText}
                onChange={(e) => setState(prev => ({ ...prev, inputText: e.target.value, error: null }))}
                placeholder="또는 여기에 안전교육 텍스트를 직접 입력하세요...&#10;파일을 업로드하면 내용이 여기에 자동으로 표시됩니다."
                className="w-full h-48 p-4 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none text-lg leading-relaxed text-slate-800 placeholder-slate-400 transition-all"
                />
                {isExtracting && (
                     <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] rounded-xl z-10 flex items-center justify-center">
                     </div>
                )}
            </div>
            <p className="mt-2 text-xs text-slate-400 text-right">
                {state.inputText.length > 0 && (
                    <span className={state.inputText.length > MAX_INPUT_LENGTH ? "text-red-500 font-bold" : "text-slate-500"}>
                        {state.inputText.length.toLocaleString()} / {MAX_INPUT_LENGTH.toLocaleString()} 자
                    </span>
                )}
            </p>
          </div>
        </section>

        {/* Language Selection & Action */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-600 mb-3 ml-1">대상 언어 선택 (Target Language)</label>
            <div className="grid grid-cols-2 gap-3">
              {Object.values(TargetLanguage).map((lang) => {
                const info = LANGUAGE_LABELS[lang];
                const isSelected = state.selectedLanguage === lang;
                return (
                  <button
                    key={lang}
                    onClick={() => setState(prev => ({ ...prev, selectedLanguage: lang, result: null }))}
                    className={`relative flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all duration-200 ${
                      isSelected 
                        ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-md transform scale-[1.02]' 
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-2xl mb-1">{info.flag}</span>
                    <span className="font-bold text-sm">{info.label}</span>
                    <span className="text-xs opacity-75">{info.native}</span>
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-2 h-2 bg-blue-600 rounded-full"></div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col justify-end">
            <button
              onClick={handleTranslateAndSpeak}
              disabled={state.isProcessing || isExtracting || !state.inputText.trim()}
              className={`w-full h-[120px] md:h-full rounded-xl flex flex-col items-center justify-center text-white font-bold text-xl shadow-lg transition-all duration-200 ${
                state.isProcessing || isExtracting || !state.inputText.trim()
                  ? 'bg-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 hover:shadow-xl active:scale-[0.98]'
              }`}
            >
              {state.isProcessing ? (
                <>
                  <Loader2 className="animate-spin mb-2" size={32} />
                  <span className="text-base">처리중 (AI)...</span>
                </>
              ) : (
                <>
                  <Volume2 className="mb-2" size={36} />
                  <span>통역 시작</span>
                  <span className="text-xs font-normal opacity-80 mt-1">Translate & Speak</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* Error Message */}
        {state.error && (
          <div className="mb-8 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-r-lg flex items-start animate-fade-in">
            <AlertTriangle className="mr-3 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-bold">안내</p>
              <p className="text-sm">{state.error}</p>
            </div>
          </div>
        )}

        {/* Result Section */}
        {state.result && (
          <section className="bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-800 animate-fade-in-up">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>
            
            <div className="p-6 md:p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3 text-white">
                  <span className="text-3xl">{LANGUAGE_LABELS[state.result.targetLanguage].flag}</span>
                  <div>
                    <h3 className="text-xl font-bold">
                      {LANGUAGE_LABELS[state.result.targetLanguage].native}
                    </h3>
                    <p className="text-slate-400 text-sm">
                      {LANGUAGE_LABELS[state.result.targetLanguage].label} 번역 결과
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-3">
                   {/* Audio Controls */}
                   {!state.result.audioBuffer ? (
                        <div className="text-slate-400 text-xs flex flex-col items-center">
                            {state.isProcessing ? (
                                <>
                                    <Loader2 className="animate-spin mb-1" size={20} />
                                    <span>음성 생성중...</span>
                                </>
                            ) : (
                                <>
                                    <VolumeX size={20} className="mb-1 opacity-50" />
                                    <span>음성 없음</span>
                                </>
                            )}
                        </div>
                   ) : (isPlaying || isPaused) ? (
                     <>
                        <button 
                            onClick={isPlaying ? handlePause : handleResume}
                            className={`flex items-center justify-center w-12 h-12 rounded-full text-white transition-colors shadow-lg ${
                                isPlaying 
                                ? "bg-amber-500 hover:bg-amber-600 shadow-amber-500/30" 
                                : "bg-green-500 hover:bg-green-600 shadow-green-500/30 animate-pulse-slow"
                            }`}
                            title={isPlaying ? "일시정지" : "계속 재생"}
                        >
                            {isPlaying ? (
                                <Pause size={20} fill="currentColor" />
                            ) : (
                                <Play size={20} fill="currentColor" className="ml-1" />
                            )}
                        </button>

                        <button 
                            onClick={stopAudio}
                            className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-700 text-slate-300 hover:bg-red-500 hover:text-white transition-colors shadow-lg"
                            title="정지"
                        >
                            <Square size={18} fill="currentColor" />
                        </button>
                     </>
                   ) : (
                     <button 
                       onClick={handleReplay}
                       className="flex items-center justify-center w-12 h-12 rounded-full bg-green-500 text-white hover:bg-green-600 transition-colors shadow-lg shadow-green-500/30 animate-pulse-slow"
                     >
                       <Play size={24} fill="currentColor" className="ml-1" />
                     </button>
                   )}
                </div>
              </div>

              {/* Visualization Placeholder / Audio Status */}
              <div className="bg-slate-800/50 rounded-xl p-6 mb-6 border border-slate-700 backdrop-blur-sm">
                <p className="text-2xl md:text-3xl font-medium leading-relaxed text-slate-100 break-words whitespace-pre-line">
                  {state.result.translatedText}
                </p>
              </div>

              <div className="flex items-center justify-between text-slate-500 text-xs uppercase tracking-widest">
                <span>AI Neural Voice</span>
                <span className={`flex items-center space-x-2 ${isPlaying ? 'text-green-400' : isPaused ? 'text-amber-400' : 'text-slate-600'}`}>
                  <span className={`block w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500 animate-ping' : isPaused ? 'bg-amber-500' : 'bg-slate-600'}`}></span>
                  <span>
                    {isPlaying ? 'Speaking...' : isPaused ? 'Paused' : state.result.audioBuffer ? 'Ready' : 'No Audio'}
                  </span>
                </span>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-6 mt-auto">
        <div className="container mx-auto px-4 text-center text-slate-500 text-sm">
          <p>© 2024 Construction Safety AI Interpreter.</p>
          <p className="mt-1 text-xs text-slate-400">Powered by Google Gemini 2.5 Flash TTS</p>
        </div>
      </footer>
    </div>
  );
};

export default App;