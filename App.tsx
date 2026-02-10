import React, { useState } from 'react';
import { Reader } from './components/Reader';
import { ImageGenerator } from './components/ImageGenerator';
import { AppMode } from './types';

function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.READER);

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              G
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
              Gemini Omni
            </h1>
          </div>
          
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setMode(AppMode.READER)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                mode === AppMode.READER 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Reader
            </button>
            <button
              onClick={() => setMode(AppMode.IMAGE_GEN)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                mode === AppMode.IMAGE_GEN 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Studio
            </button>
          </div>
        </div>
      </nav>

      <main className="py-8">
        {mode === AppMode.READER ? <Reader /> : <ImageGenerator />}
      </main>
    </div>
  );
}

export default App;
