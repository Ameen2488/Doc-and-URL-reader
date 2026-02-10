import React, { useState, useRef, useEffect, useCallback } from 'react';
import { analyzePageContent, analyzeHtmlContent, generateSpeech, generateChapters } from '../services/geminiService';
import { loadPdfDocument, renderPdfPage, cropImageFromBase64, extractPdfText } from '../utils/pdfUtils';
import { loadEpubDocument, extractEpubChapters, getEpubChapterContent } from '../utils/epubUtils';
import { ReadingSegment, Chapter } from '../types';

export const Reader: React.FC = () => {
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file');
  const [urlInput, setUrlInput] = useState('');
  
  // Doc State
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [epubBook, setEpubBook] = useState<any>(null);
  const [fileType, setFileType] = useState<'pdf' | 'epub' | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string>('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  
  // Playback State
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [segments, setSegments] = useState<ReadingSegment[]>([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [hasSavedState, setHasSavedState] = useState(false);
  
  // Audio Settings
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(1.0);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true); // Default open on desktop
  
  // Refs
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const segmentRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    const saved = localStorage.getItem('gemini_reader_progress');
    if (saved) setHasSavedState(true);
  }, []);

  // Audio Logic Update Hooks
  useEffect(() => {
    if (audioSourceRef.current && isPlaying) {
      try { audioSourceRef.current.playbackRate.setValueAtTime(playbackSpeed, audioContext?.currentTime || 0); } catch (e) {}
    }
  }, [playbackSpeed, isPlaying, audioContext]);

  useEffect(() => {
    if (gainNodeRef.current) {
       try { gainNodeRef.current.gain.setValueAtTime(volume, audioContext?.currentTime || 0); } catch(e) {}
    }
  }, [volume, audioContext]);

  const initAudio = () => {
    if (!audioContext) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      setAudioContext(ctx);
      return ctx;
    }
    return audioContext;
  };

  const resetState = () => {
    setSegments([]);
    setCurrentSegmentIndex(-1);
    setIsPlaying(false);
    if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch(e) {}
    }
  };

  // --- Core Processing Logic ---

  // 1. Load Chapter Content
  const processChapter = async (chapter: Chapter, doc: any) => {
      setIsLoading(true);
      setLoadingStep(`Analyzing Chapter: ${chapter.title}`);
      resetState();
      setCurrentChapter(chapter);

      try {
          let newSegments: ReadingSegment[] = [];

          if (inputMode === 'file' && fileType === 'pdf' && doc) {
              // PDF Mode
              const start = chapter.startPage;
              const end = Math.min(chapter.endPage, start + 4); 
              
              const pagePromises = [];
              for (let i = start; i <= end; i++) {
                  pagePromises.push((async () => {
                      const imageBase64 = await renderPdfPage(doc, i);
                      const rawSegments = await analyzePageContent(imageBase64);
                      
                      // Crop Visuals
                      const enhancedSegments = await Promise.all(rawSegments.map(async (seg) => {
                        if (seg.type === 'visual_description' && seg.bbox) {
                            try {
                                const url = await cropImageFromBase64(imageBase64, seg.bbox);
                                return { ...seg, imageUrl: url };
                            } catch(e) { return seg; }
                        }
                        return seg;
                      }));
                      return enhancedSegments;
                  })());
              }

              const results = await Promise.all(pagePromises);
              newSegments = results.flat();

          } else if (inputMode === 'file' && fileType === 'epub' && epubBook) {
              // EPUB Mode
              const htmlContent = await getEpubChapterContent(epubBook, chapter);
              newSegments = await analyzeHtmlContent(htmlContent);

          } else if (inputMode === 'url' && chapter.content) {
              // URL Mode
               newSegments = await analyzeHtmlContent(chapter.content);
               
                // Relative URL Fix
                const targetUrl = urlInput.startsWith('http') ? urlInput : `https://${urlInput}`;
                newSegments = newSegments.map(seg => {
                    if (seg.imageUrl && !seg.imageUrl.startsWith('http') && !seg.imageUrl.startsWith('data:')) {
                        try {
                            const resolved = new URL(seg.imageUrl, targetUrl).toString();
                            return { ...seg, imageUrl: resolved };
                        } catch (e) { return seg; }
                    }
                    return seg;
                });
          }

          setSegments(newSegments);

      } catch (e) {
          console.error("Chapter processing failed", e);
          alert("Failed to load chapter content.");
      } finally {
          setIsLoading(false);
          setLoadingStep('');
      }
  };

  // 2. Handle File Upload (Ingest Structure)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setPdfFileName(selectedFile.name);
      setIsLoading(true);
      setLoadingStep('Scanning document structure...');
      resetState();
      setChapters([]);
      setPdfDoc(null);
      setEpubBook(null);

      try {
        if (selectedFile.name.toLowerCase().endsWith('.epub')) {
            // Handle EPUB
            setFileType('epub');
            const book = await loadEpubDocument(selectedFile);
            setEpubBook(book);
            
            const extractedChapters = await extractEpubChapters(book);
            // Map to our Chapter interface (add extra fields if needed)
            const mappedChapters: Chapter[] = extractedChapters.map((c: any) => ({
                id: c.id,
                title: c.title,
                startPage: 0,
                endPage: 0,
                // store href in existing Chapter interface, maybe cast or assume logic uses it
                ...c 
            }));
            
            setChapters(mappedChapters);
            if (mappedChapters.length > 0) {
                await processChapter(mappedChapters[0], null);
            }

        } else {
            // Handle PDF
            setFileType('pdf');
            const doc = await loadPdfDocument(selectedFile);
            setPdfDoc(doc);
            
            // Extract Text for Structure
            const { fullText } = await extractPdfText(doc);
            
            setLoadingStep('Generating Table of Contents...');
            const generatedChapters = await generateChapters(fullText, true);
            setChapters(generatedChapters);

            // Auto-select first chapter
            if (generatedChapters.length > 0) {
                await processChapter(generatedChapters[0], doc);
            }
        }

      } catch (error) {
        console.error("Processing failed", error);
        alert("Failed to process file. Ensure it is a valid PDF or EPUB.");
        setIsLoading(false);
      }
    }
  };

  // 3. Handle URL (Ingest Structure)
  const handleUrlSubmit = async () => {
    if (!urlInput.trim()) return;
    let targetUrl = urlInput.trim();
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = `https://${targetUrl}`;

    setIsLoading(true);
    setLoadingStep('Fetching website content...');
    resetState();
    setChapters([]);
    setPdfDoc(null);
    setEpubBook(null);
    setFileType(null);
    setPdfFileName('');

    try {
        let htmlText = '';
        try {
            const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`);
            if (!res.ok) throw new Error('Proxy failed');
            htmlText = await res.text();
        } catch (err) {
             const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
             htmlText = await res.text();
        }

        if (!htmlText || htmlText.length < 50) throw new Error("Empty content");

        setLoadingStep('Analyzing structure...');
        const generatedChapters = await generateChapters(htmlText, false);
        
        const chaptersWithContent = generatedChapters.map(c => ({
            ...c,
            content: htmlText 
        }));
        
        setChapters(chaptersWithContent);

        if (chaptersWithContent.length > 0) {
            await processChapter(chaptersWithContent[0], null);
        }

    } catch (error) {
        console.error("URL Processing failed", error);
        alert("Failed to process URL.");
        setIsLoading(false);
    }
  };

  // --- Save/Restore ---
  const saveProgress = () => {
      if (!currentChapter) return;
      try {
          const state = {
              inputMode,
              urlInput,
              pdfFileName,
              fileType,
              chapters,
              currentChapterId: currentChapter.id,
              segments: segments.map(({ audioBuffer, ...rest }) => rest), 
              currentSegmentIndex,
              timestamp: Date.now()
          };
          localStorage.setItem('gemini_reader_progress', JSON.stringify(state));
          setHasSavedState(true);
          alert("Progress saved!");
      } catch(e) { alert("Failed to save."); }
  };

  const restoreProgress = () => {
      const raw = localStorage.getItem('gemini_reader_progress');
      if (!raw) return;
      try {
          const state = JSON.parse(raw);
          if (audioSourceRef.current) try { audioSourceRef.current.stop(); } catch(e){}
          setIsPlaying(false);

          setInputMode(state.inputMode);
          setUrlInput(state.urlInput || '');
          setPdfFileName(state.pdfFileName || '');
          setFileType(state.fileType || (state.inputMode === 'file' ? 'pdf' : null));
          setChapters(state.chapters);
          setSegments(state.segments);
          setCurrentSegmentIndex(state.currentSegmentIndex);

          const restoredChapter = state.chapters.find((c: any) => c.id === state.currentChapterId);
          if (restoredChapter) setCurrentChapter(restoredChapter);

          if (state.inputMode === 'file') {
              alert("Session structure restored. Please re-upload the file to resume reading content.");
              setPdfDoc(null);
              setEpubBook(null);
          }
      } catch(e) { console.error(e); }
  };

  // --- Audio Logic (Play, Scroll, Advance) ---
  
  const playSegment = useCallback(async (index: number) => {
    if (index >= segments.length) {
        // End of chapter - Auto Advance?
        const currentIdx = chapters.findIndex(c => c.id === currentChapter?.id);
        if (currentIdx !== -1 && currentIdx < chapters.length - 1) {
            setTimeout(() => {
                const nextChapter = chapters[currentIdx + 1];
                // Pass appropriate doc ref
                processChapter(nextChapter, fileType === 'pdf' ? pdfDoc : null);
            }, 1000);
        }
        setIsPlaying(false);
        setCurrentSegmentIndex(-1);
        return;
    }
    if (index < 0) return;

    const ctx = initAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();

    setCurrentSegmentIndex(index);
    const segment = segments[index];

    try {
        let buffer = segment.audioBuffer;
        if (!buffer) {
            const fetched = await generateSpeech(segment.content, ctx);
            if (fetched) {
                segment.audioBuffer = fetched;
                buffer = fetched;
                setSegments(prev => {
                    const copy = [...prev];
                    copy[index].audioBuffer = fetched;
                    return copy;
                });
            }
        }

        if (buffer) {
            if (audioSourceRef.current) try { audioSourceRef.current.stop(); } catch(e){}
            
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = playbackSpeed;

            const gain = ctx.createGain();
            gain.gain.value = volume;

            source.connect(gain);
            gain.connect(ctx.destination);

            gainNodeRef.current = gain;
            audioSourceRef.current = source;

            source.addEventListener('ended', () => {
                if (audioSourceRef.current === source) {
                    playSegment(index + 1);
                }
            });
            source.start();
        } else {
            playSegment(index + 1);
        }
    } catch(e) { setIsPlaying(false); }
  }, [segments, isPlaying, audioContext, playbackSpeed, volume, chapters, currentChapter, pdfDoc, epubBook, fileType]);

  const togglePlay = () => {
      if (segments.length === 0) return;
      if (isPlaying) {
          setIsPlaying(false);
          if (audioSourceRef.current) try { audioSourceRef.current.stop(); } catch(e){}
      } else {
          setIsPlaying(true);
          playSegment(currentSegmentIndex === -1 ? 0 : currentSegmentIndex);
      }
  };

  // Enhanced Auto-Scroll Effect
  useEffect(() => {
    if (currentSegmentIndex >= 0 && segments.length > currentSegmentIndex) {
      const segment = segments[currentSegmentIndex];
      const el = segmentRefs.current[segment.id];
      if (el) {
          requestAnimationFrame(() => {
              el.scrollIntoView({ 
                  behavior: 'smooth', 
                  block: 'center',
                  inline: 'nearest'
              });
          });
      }
    }
  }, [currentSegmentIndex, segments]);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 flex flex-col md:flex-row gap-6 min-h-[calc(100vh-100px)]">
      
      {/* Sidebar: Chapters */}
      <div className={`
         fixed md:sticky top-0 left-0 h-full md:h-auto z-40 bg-white md:bg-transparent
         w-64 transform transition-transform duration-300 ease-in-out border-r border-slate-200 md:border-none p-4 md:p-0
         ${showSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
         md:w-1/4 md:block
      `}>
          <div className="mb-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm sticky top-24">
              <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-800">Chapters</h3>
                  <button onClick={() => setShowSidebar(false)} className="md:hidden text-slate-400">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
              </div>
              
              {chapters.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No document loaded.</p>
              ) : (
                  <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                      {chapters.map((chap, idx) => (
                          <button
                            key={chap.id}
                            onClick={() => !isLoading && processChapter(chap, fileType === 'pdf' ? pdfDoc : epubBook)}
                            disabled={isLoading}
                            className={`w-full text-left p-3 rounded-lg text-sm transition-all ${
                                currentChapter?.id === chap.id
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'hover:bg-slate-50 text-slate-600'
                            }`}
                          >
                              <div className="font-medium">{idx + 1}. {chap.title}</div>
                              {inputMode === 'file' && fileType === 'pdf' && (
                                  <div className={`text-xs mt-1 ${currentChapter?.id === chap.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                                      Pages {chap.startPage}-{chap.endPage}
                                  </div>
                              )}
                          </button>
                      ))}
                  </div>
              )}
          </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 w-full">
         
         {/* Top Card: Input */}
         <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Smart Document Reader</h2>
                    {hasSavedState && (
                        <button onClick={restoreProgress} className="text-xs text-indigo-600 font-medium hover:underline mt-1">
                            Restore Previous Session
                        </button>
                    )}
                </div>
                <button onClick={() => setShowSidebar(!showSidebar)} className="md:hidden p-2 text-slate-500">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                </button>
            </div>

            <div className="flex gap-4 mb-4 border-b border-slate-100 pb-2">
                <button onClick={() => setInputMode('file')} className={`pb-2 text-sm font-semibold transition-colors relative ${inputMode === 'file' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>Upload File (PDF/EPUB)</button>
                <button onClick={() => setInputMode('url')} className={`pb-2 text-sm font-semibold transition-colors relative ${inputMode === 'url' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>Paste URL</button>
            </div>

            <div className="flex flex-col md:flex-row gap-4 items-center">
                {inputMode === 'file' ? (
                    <label className="flex-1 cursor-pointer w-full bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4 hover:bg-slate-100 transition-colors text-center">
                        <span className="text-sm font-medium text-slate-600">
                            {pdfFileName ? pdfFileName : "Click to select a PDF or EPUB"}
                        </span>
                        <input type="file" accept="application/pdf,.epub" onChange={handleFileUpload} className="hidden" />
                    </label>
                ) : (
                    <div className="flex-1 flex gap-2 w-full">
                        <input type="url" placeholder="https://..." value={urlInput} onChange={e => setUrlInput(e.target.value)} className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm" />
                        <button onClick={handleUrlSubmit} className="px-6 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700">Scan</button>
                    </div>
                )}
            </div>

            {isLoading && (
                <div className="mt-4 flex items-center gap-3 text-indigo-600 text-sm bg-indigo-50 p-3 rounded-lg animate-pulse">
                     <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                     <span>{loadingStep || 'Processing...'}</span>
                </div>
            )}
         </div>

         {/* Content Area */}
         {segments.length > 0 && (
             <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden relative">
                 {/* Sticky Player Controls */}
                 <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-100 p-4">
                     <div className="flex flex-wrap justify-between items-center gap-4">
                         <div className="font-bold text-slate-800 truncate max-w-[200px]">
                             {currentChapter?.title || "Reading"}
                         </div>
                         
                         <div className="flex items-center gap-3">
                            <button onClick={saveProgress} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.47 1.72a.75.75 0 011.06 0l3 3a.75.75 0 01-1.06 1.06l-1.72-1.72V7.5h-1.5V4.06L9.53 5.78a.75.75 0 01-1.06-1.06l3-3zM11.25 7.5V15a.75.75 0 001.5 0V7.5h3.75a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9a3 3 0 013-3h3.75z" /></svg></button>
                            <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-full transition-colors ${showSettings ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-slate-600'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M11.828 2.25c-.916 0-1.699.663-1.85 1.567l-.091.549a.798.798 0 01-.517.608 7.45 7.45 0 00-.478.198.798.798 0 01-.796-.064l-.453-.324a1.875 1.875 0 00-2.416.2l-.043.044a1.875 1.875 0 00-.2 2.416l.324.453a.798.798 0 01.064.796 7.448 7.448 0 00-.198.478.798.798 0 01-.608.517l-.55.091a1.875 1.875 0 00-1.566 1.85v.06c0 .916.663 1.699 1.567 1.85l.549.091c.281.047.508.25.608.517.06.162.127.321.198.478a.798.798 0 01-.064.796l-.324.453a1.875 1.875 0 00.2 2.416l.044.043c.645.645 1.692.732 2.416.2l.453-.324a.798.798 0 01.796-.064c.157.071.316.137.478.198.267.1.47.327.517.608l.092.55c.15.903.932 1.566 1.849 1.566h.06c.916 0 1.699-.663 1.85-1.567l.091-.549a.798.798 0 01.517-.608 7.52 7.52 0 00.478-.198.798.798 0 01.796.064l.453.324a1.875 1.875 0 002.416-.2l.043-.044a1.875 1.875 0 00.2-2.416l-.324-.453a.798.798 0 01-.064-.796c.071-.157.137-.316.198-.478.1-.267.327-.47.608-.517l.55-.092a1.875 1.875 0 001.566-1.85v-.06c0-.916-.663-1.699-1.567-1.85l-.549-.091a.798.798 0 01-.608-.517 7.507 7.507 0 00-.198-.478.798.798 0 01.064-.796l.324-.453a1.875 1.875 0 00-.2-2.416l-.044-.043a1.875 1.875 0 00-2.416-.2l-.453.324a.798.798 0 01-.796.064 7.462 7.462 0 00-.478-.198.798.798 0 01-.517-.608l-.092-.55a1.875 1.875 0 00-1.85-1.566h-.06zM12 15a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
                            </button>
                            <button onClick={togglePlay} className={`px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2 ${isPlaying ? 'bg-rose-100 text-rose-600' : 'bg-indigo-600 text-white'}`}>
                                {isPlaying ? 'Pause' : 'Read Aloud'}
                            </button>
                         </div>
                     </div>
                     
                     {showSettings && (
                         <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-end gap-6 text-sm animate-fade-in">
                             <div className="flex items-center gap-2">
                                 <span className="text-slate-500">Speed</span>
                                 <div className="flex bg-slate-100 rounded-md p-1">{[0.75, 1, 1.25, 1.5, 2].map(s => <button key={s} onClick={() => setPlaybackSpeed(s)} className={`px-2 py-0.5 rounded text-xs ${playbackSpeed === s ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>{s}x</button>)}</div>
                             </div>
                             <div className="flex items-center gap-2">
                                 <span className="text-slate-500">Volume</span>
                                 <input type="range" min="0" max="1" step="0.1" value={volume} onChange={e => setVolume(Number(e.target.value))} className="w-20 accent-indigo-600" />
                             </div>
                         </div>
                     )}
                 </div>

                 {/* Reading Script */}
                 <div className="p-6 md:p-8 space-y-6">
                     {segments.map((seg, idx) => (
                         <div key={seg.id} ref={el => {segmentRefs.current[seg.id] = el}} onClick={() => { setIsPlaying(true); playSegment(idx); }} className={`p-4 rounded-xl cursor-pointer transition-all ${currentSegmentIndex === idx ? 'bg-indigo-50 border-l-4 border-indigo-500' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}>
                             {seg.type === 'visual_description' ? (
                                 <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
                                     {seg.imageUrl && <img src={seg.imageUrl} alt="Visual" className="mb-4 rounded-lg shadow-sm max-h-80 mx-auto object-contain bg-white" />}
                                     <div className="flex gap-3 text-amber-900">
                                         <svg className="w-5 h-5 flex-shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                                         <div>
                                            <div className="text-xs font-bold uppercase text-amber-600 mb-1">Visual Explained</div>
                                            <p className="italic">{seg.content}</p>
                                         </div>
                                     </div>
                                 </div>
                             ) : (
                                 <p className={`text-lg leading-relaxed ${currentSegmentIndex === idx ? 'text-slate-900 font-medium' : 'text-slate-600'}`}>{seg.content}</p>
                             )}
                         </div>
                     ))}
                 </div>
             </div>
         )}
      </div>
    </div>
  );
};