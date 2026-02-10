import React, { useState } from 'react';
import { generateImagePro } from '../services/geminiService';
import { ImageGenerationConfig } from '../types';

export const ImageGenerator: React.FC = () => {
  const [config, setConfig] = useState<ImageGenerationConfig>({
    prompt: '',
    size: '1K'
  });
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setError(null);
    setIsLoading(true);

    try {
      // 1. Check/Get API Key via AI Studio
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        // Assume success as per instructions, or retry if fail catch block logic needed
        // but prompt says: "Assume the key selection was successful after triggering openSelectKey()"
      }
      
      // Get the key (it's auto-injected into process.env.API_KEY by the environment after selection ideally,
      // but the prompt says: "The selected API key is available via process.env.API_KEY. It is injected automatically"
      // Wait, if I need to construct a new GoogleGenAI with this key, I should just use process.env.API_KEY.
      // However, to ensure we pick up the *newly* selected key if it wasn't there before, 
      // we might need to rely on the fact that process.env.API_KEY is updated.
      
      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error("API Key not available. Please select a key.");
      }

      const imageUrl = await generateImagePro(config.prompt, config.size, apiKey);
      
      if (imageUrl) {
        setGeneratedImage(imageUrl);
      } else {
        throw new Error("No image generated.");
      }

    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes("Requested entity was not found")) {
         setError("API Key issue. Please select your key again.");
         await window.aistudio.openSelectKey();
      } else {
         setError("Failed to generate image. Try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="flex items-center gap-3 mb-6">
           <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
               <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
             </svg>
           </div>
           <div>
             <h2 className="text-2xl font-bold text-slate-800">Studio Pro</h2>
             <p className="text-sm text-slate-500">Generate high-fidelity visuals (up to 4K)</p>
           </div>
        </div>

        <div className="space-y-6">
           <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Prompt</label>
              <textarea 
                value={config.prompt}
                onChange={(e) => setConfig({...config, prompt: e.target.value})}
                placeholder="A futuristic city with flying cars in a cyberpunk style..."
                className="w-full h-32 p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none bg-slate-50"
              />
           </div>

           <div>
             <label className="block text-sm font-medium text-slate-700 mb-2">Resolution</label>
             <div className="flex gap-4">
               {['1K', '2K', '4K'].map((size) => (
                 <button
                   key={size}
                   onClick={() => setConfig({...config, size: size as any})}
                   className={`flex-1 py-3 px-4 rounded-xl border font-medium transition-all ${
                     config.size === size 
                       ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' 
                       : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                   }`}
                 >
                   {size}
                 </button>
               ))}
             </div>
           </div>

           {error && (
             <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm">
               {error}
             </div>
           )}

           <button
             onClick={handleGenerate}
             disabled={isLoading || !config.prompt.trim()}
             className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex justify-center items-center gap-2 ${
               isLoading || !config.prompt.trim()
                 ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                 : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:shadow-lg hover:scale-[1.01]'
             }`}
           >
             {isLoading ? 'Generating...' : 'Generate Image'}
           </button>
        </div>
      </div>

      {generatedImage && (
        <div className="mt-8 animate-fade-in">
           <div className="bg-white p-4 rounded-2xl shadow-lg border border-slate-200">
             <img src={generatedImage} alt="Generated" className="w-full rounded-xl" />
             <div className="mt-4 flex justify-between items-center text-sm text-slate-500 px-2">
               <span>Generated with Gemini 3 Pro</span>
               <a 
                 href={generatedImage} 
                 download="gemini-creation.png"
                 className="text-indigo-600 hover:text-indigo-800 font-medium"
               >
                 Download
               </a>
             </div>
           </div>
        </div>
      )}
    </div>
  );
};
