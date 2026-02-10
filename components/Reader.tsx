import React, { useState, useRef, useEffect, useCallback } from 'react';
import { analyzePageContent, analyzeHtmlContent, generateSpeech } from '../services/geminiService';
import { loadPdfDocument, renderPdfPage, cropImageFromBase64 } from '../utils/pdfUtils';
import { ReadingSegment } from '../types';

export const Reader: React.FC = () => {
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file');
  const [urlInput, setUrlInput] = useState('');
  
  // PDF State
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfFileName, setPdfFileName] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  
  const [isLoading, setIsLoading] = useState(false);
  const [segments, setSegments] = useState<ReadingSegment[]>([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [hasSavedState, setHasSavedState] = useState(false);
  
  // Refs for audio playback management
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const segmentRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    const saved = localStorage.getItem('gemini_reader_progress');
    if (saved) setHasSavedState(true);
  }, []);

  // Initialize Audio Context on user interaction (upload or play)
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
        audioSourceRef.current.stop();
    }
  };

  const saveProgress = () => {
    if (segments.length === 0) return;
    try {
        const state = {
            inputMode,
            urlInput,
            currentPage,
            totalPages,
            segments: segments.map(s => {
                // Destructure to exclude audioBuffer which is not serializable
                const { audioBuffer, ...rest } = s; 
                return rest;
            }),
            currentSegmentIndex,
            pdfFileName,
            timestamp: Date.now()
        };
        localStorage.setItem('gemini_reader_progress', JSON.stringify(state));
        setHasSavedState(true);
        alert("Progress saved successfully!");
    } catch (e) {
        console.error("Save failed", e);
        alert("Could not save progress. Storage quota might be exceeded.");
    }
  };

  const restoreProgress = () => {
    const raw = localStorage.getItem('gemini_reader_progress');
    if (!raw) return;
    
    try {
        const state = JSON.parse(raw);
        
        // Stop any current playback
        if (audioSourceRef.current) audioSourceRef.current.stop();
        setIsPlaying(false);
        
        setInputMode(state.inputMode);
        setUrlInput(state.urlInput || '');
        setCurrentPage(state.currentPage);
        setTotalPages(state.totalPages);
        setPdfFileName(state.pdfFileName || '');
        setSegments(state.segments);
        setCurrentSegmentIndex(state.currentSegmentIndex);
        
        if (state.inputMode === 'file') {
             // We cannot restore the pdfDoc object, so navigation is disabled until re-upload
             alert(`Session restored for "${state.pdfFileName || 'PDF'}" on page ${state.currentPage}.\n\nNote: To navigate to other pages, please re-upload the PDF file.`);
             setPdfDoc(null);
        }
    } catch (e) {
        console.error("Restore failed", e);
        alert("Failed to restore session data.");
    }
  };

  const processPdfPage = async (doc: any, pageNum: number) => {
    setIsLoading(true);
    resetState();
    
    try {
      const imageBase64 = await renderPdfPage(doc, pageNum);
      const pageSegments = await analyzePageContent(imageBase64);
      
      // Post-process segments to extract visual crops
      const processedSegments = await Promise.all(pageSegments.map(async (seg) => {
          if (seg.type === 'visual_description' && seg.bbox && seg.bbox.length === 4) {
              try {
                  const croppedImage = await cropImageFromBase64(imageBase64, seg.bbox);
                  return { ...seg, imageUrl: croppedImage };
              } catch (e) {
                  console.warn("Failed to crop visual", e);
                  return seg;
              }
          }
          return seg;
      }));

      setSegments(processedSegments);
    } catch (error) {
      console.error("Page processing failed", error);
      alert("Failed to analyze page content.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setPdfFileName(selectedFile.name);
      setIsLoading(true);
      resetState();
      setPdfDoc(null);

      try {
        const doc = await loadPdfDocument(selectedFile);
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        
        await processPdfPage(doc, 1);
      } catch (error) {
        console.error("Processing failed", error);
        alert("Failed to process PDF. Please try again.");
        setIsLoading(false);
      }
    }
  };

  const changePage = async (newPage: number) => {
    if (!pdfDoc) {
        alert("Please upload the PDF file again to navigate between pages.");
        return;
    }
    if (newPage < 1 || newPage > totalPages || isLoading) return;
    
    setCurrentPage(newPage);
    await processPdfPage(pdfDoc, newPage);
  };

  const handleUrlSubmit = async () => {
    if (!urlInput.trim()) return;
    
    // 1. Sanitize URL (ensure protocol)
    let targetUrl = urlInput.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    setIsLoading(true);
    resetState();
    setPdfDoc(null); // Clear PDF state
    setPdfFileName('');

    try {
        let htmlText = '';
        
        // 2. Fetch with Retries (Proxy Failover)
        try {
            // Primary Proxy: AllOrigins
            const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`);
            if (!res.ok) throw new Error('AllOrigins failed');
            htmlText = await res.text();
        } catch (err) {
            console.warn('Primary proxy failed, switching to backup...');
            try {
                // Backup Proxy: CorsProxy.io
                // Note: corsproxy.io requires the URL to be appended directly
                const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
                if (!res.ok) throw new Error('Backup proxy failed');
                htmlText = await res.text();
            } catch (err2) {
                 // Final fallback attempt: Local proxy or error
                 throw new Error('Unable to fetch URL content. Site may be protected.');
            }
        }

        if (!htmlText || htmlText.length < 50) {
             throw new Error("Retrieved content is empty or invalid.");
        }

        const urlSegments = await analyzeHtmlContent(htmlText);
        
        // Fix relative URLs for Web Mode
        const processedSegments = urlSegments.map(seg => {
            if (seg.imageUrl && !seg.imageUrl.startsWith('http')) {
                // Attempt to resolve relative URL using the input target URL as base
                try {
                    const resolved = new URL(seg.imageUrl, targetUrl).toString();
                    return { ...seg, imageUrl: resolved };
                } catch (e) {
                    return seg;
                }
            }
            return seg;
        });

        setSegments(processedSegments);

    } catch (error) {
        console.error("URL Processing failed", error);
        alert("Failed to process URL. The site might be blocking access, or the content is unavailable.");
    } finally {
        setIsLoading(false);
    }
  };

  // Play a specific segment
  const playSegment = useCallback(async (index: number) => {
    if (index >= segments.length || index < 0) {
      setIsPlaying(false);
      setCurrentSegmentIndex(-1);
      return;
    }

    const ctx = initAudio();
    if (!ctx) return;
    
    // Resume context if suspended (browser policy)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    setCurrentSegmentIndex(index);
    const segment = segments[index];

    // Note: Auto-scrolling is handled by a separate useEffect now

    try {
      // Check if we already have the buffer, if not fetch it
      let buffer = segment.audioBuffer;
      if (!buffer) {
        // Show generic loading state for audio if needed, usually fast enough
        const fetchedBuffer = await generateSpeech(segment.content, ctx);
        if (fetchedBuffer) {
          // Cache it (in a real app, careful with memory, here it's fine)
          segment.audioBuffer = fetchedBuffer;
          buffer = fetchedBuffer;
          // Update state to save buffer
          setSegments(prev => {
            const newSegs = [...prev];
            newSegs[index].audioBuffer = fetchedBuffer;
            return newSegs;
          });
        }
      }

      if (buffer) {
        if (audioSourceRef.current) {
          audioSourceRef.current.stop();
        }
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        
        // Manual chaining hack to ensure we play next
        source.addEventListener('ended', () => {
            // Need to check if we should continue
             setCurrentSegmentIndex(prev => {
               if (prev + 1 < segments.length) {
                 return prev + 1;
               } else {
                 setIsPlaying(false);
                 return -1;
               }
             });
        });

        audioSourceRef.current = source;
        source.start();
      } else {
        // Skip if no audio generated
        setCurrentSegmentIndex(prev => prev + 1);
      }
    } catch (e) {
      console.error(e);
      setIsPlaying(false);
    }
  }, [segments, isPlaying, audioContext]);

  // Effect to trigger play when index changes AND isPlaying is true
  useEffect(() => {
    if (isPlaying && currentSegmentIndex >= 0) {
        // Small delay to ensure render
        const timer = setTimeout(() => {
             playSegment(currentSegmentIndex);
        }, 50);
        return () => clearTimeout(timer);
    }
  }, [currentSegmentIndex, isPlaying]); // Intentionally do not add playSegment to deps to avoid loops if memo invalidates

  // Dedicated Auto-Scroll Effect
  useEffect(() => {
    if (currentSegmentIndex >= 0 && segments[currentSegmentIndex]) {
      const segment = segments[currentSegmentIndex];
      const el = segmentRefs.current[segment.id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentSegmentIndex, segments]);

  const togglePlay = () => {
    if (segments.length === 0) return;
    
    if (isPlaying) {
      setIsPlaying(false);
      if (audioSourceRef.current) {
        audioSourceRef.current.stop();
      }
    } else {
      setIsPlaying(true);
      if (currentSegmentIndex === -1) {
        setCurrentSegmentIndex(0);
      } else {
        // Resume/Replay current
        playSegment(currentSegmentIndex);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8 p-6 bg-white rounded-2xl shadow-sm border border-slate-200 relative">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-slate-800">Smart Document Reader</h2>
            {hasSavedState && (
                <button 
                  onClick={restoreProgress}
                  className="text-sm px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
                    </svg>
                    Restore Last Session
                </button>
            )}
        </div>
        
        {/* Input Method Toggle */}
        <div className="flex gap-4 mb-6 border-b border-slate-100 pb-2">
            <button 
                onClick={() => setInputMode('file')}
                className={`pb-2 text-sm font-semibold transition-colors relative ${
                    inputMode === 'file' 
                    ? 'text-indigo-600 border-b-2 border-indigo-600' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
            >
                Upload PDF
            </button>
            <button 
                onClick={() => setInputMode('url')}
                className={`pb-2 text-sm font-semibold transition-colors relative ${
                    inputMode === 'url' 
                    ? 'text-indigo-600 border-b-2 border-indigo-600' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
            >
                Paste URL
            </button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 items-center transition-all duration-300">
          {inputMode === 'file' ? (
            <label className="flex-1 cursor-pointer w-full animate-fade-in">
                <span className="sr-only">Choose PDF</span>
                <input 
                type="file" 
                accept="application/pdf"
                onChange={handleFileUpload}
                className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-indigo-50 file:text-indigo-700
                    hover:file:bg-indigo-100"
                />
            </label>
          ) : (
            <div className="flex-1 flex gap-2 w-full animate-fade-in">
                <input 
                    type="url"
                    placeholder="https://example.com/article"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="flex-1 px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                />
                <button
                    onClick={handleUrlSubmit}
                    disabled={!urlInput || isLoading}
                    className="px-6 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Analyze
                </button>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="mt-6 flex items-center justify-center text-indigo-600 gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Analyzing {inputMode === 'file' ? `page ${currentPage}` : 'content'}...</span>
          </div>
        )}
      </div>

      {segments.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden relative">
          {/* Sticky Controls */}
          <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-slate-100 p-4 flex justify-between items-center">
             
             {/* Page Navigation or Title */}
             <div className="flex items-center gap-4">
                {inputMode === 'file' && totalPages > 0 ? (
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 border border-slate-200">
                        <button 
                            onClick={() => changePage(currentPage - 1)}
                            disabled={currentPage <= 1 || isLoading}
                            className="p-1.5 hover:bg-white rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-all text-slate-600"
                            aria-label="Previous Page"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                            </svg>
                        </button>
                        <span className="text-sm font-semibold text-slate-600 w-24 text-center tabular-nums">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button 
                            onClick={() => changePage(currentPage + 1)}
                            disabled={currentPage >= totalPages || isLoading}
                            className="p-1.5 hover:bg-white rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-all text-slate-600"
                            aria-label="Next Page"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                            </svg>
                        </button>
                    </div>
                ) : (
                    <div className="font-medium text-slate-600 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-indigo-500">
                            <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                            <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
                        </svg>
                        Web Reader
                    </div>
                )}
             </div>

             <div className="flex items-center gap-2">
                 <button
                    onClick={saveProgress}
                    title="Save current progress"
                    className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-full transition-colors"
                 >
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                       <path d="M11.47 1.72a.75.75 0 011.06 0l3 3a.75.75 0 01-1.06 1.06l-1.72-1.72V7.5h-1.5V4.06L9.53 5.78a.75.75 0 01-1.06-1.06l3-3zM11.25 7.5V15a.75.75 0 001.5 0V7.5h3.75a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9a3 3 0 013-3h3.75z" />
                     </svg>
                 </button>

                 <button 
                   onClick={togglePlay}
                   className={`flex items-center gap-2 px-6 py-2 rounded-full font-bold transition-all ${
                     isPlaying 
                     ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' 
                     : 'bg-indigo-600 text-white hover:bg-indigo-700'
                   }`}
                 >
                   {isPlaying ? (
                     <>
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                          <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                       </svg>
                       Pause
                     </>
                   ) : (
                     <>
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                          <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                       </svg>
                       Read Aloud
                     </>
                   )}
                 </button>
             </div>
          </div>

          <div className="p-8 space-y-6">
            {segments.map((seg, idx) => (
              <div 
                key={seg.id}
                ref={el => { segmentRefs.current[seg.id] = el; }}
                onClick={() => {
                   setIsPlaying(true);
                   setCurrentSegmentIndex(idx);
                }}
                className={`p-4 rounded-xl transition-all duration-300 cursor-pointer ${
                  currentSegmentIndex === idx 
                    ? 'bg-indigo-50 border-l-4 border-indigo-500 shadow-sm scale-[1.01]' 
                    : 'hover:bg-slate-50 border-l-4 border-transparent'
                }`}
              >
                {seg.type === 'visual_description' ? (
                  <div className="flex flex-col gap-4 text-slate-600 italic bg-amber-50/50 p-4 rounded-lg">
                     
                     {/* Show Image Crop if available */}
                     {seg.imageUrl && (
                        <div className="rounded-lg overflow-hidden border border-amber-200 shadow-sm mx-auto max-w-full">
                            <img src={seg.imageUrl} alt="Visual content" className="max-h-64 object-contain" />
                        </div>
                     )}

                     <div className="flex gap-4 items-start">
                        <div className="mt-1 text-amber-500 shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div>
                            <span className="text-xs font-bold text-amber-600 uppercase tracking-wider block mb-1">Visual Explained</span>
                            {seg.content}
                        </div>
                     </div>
                  </div>
                ) : (
                  <p className={`text-lg leading-relaxed ${currentSegmentIndex === idx ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>
                    {seg.content}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};