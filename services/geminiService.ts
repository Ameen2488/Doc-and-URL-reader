import { GoogleGenAI, Modality, Type } from "@google/genai";
import { ReadingSegment } from "../types";
import { decodeAudioData } from "../utils/audioUtils";

// Initialize Gemini Client
// Note: For Image Gen (Pro model), we might re-instantiate with a user-selected key in the component.
const createAiClient = (apiKey: string = process.env.API_KEY || '') => {
  return new GoogleGenAI({ apiKey });
};

// 1. Analyze Page Content (Text + Visuals)
export const analyzePageContent = async (base64Image: string): Promise<ReadingSegment[]> => {
  const ai = createAiClient();
  
  const prompt = `
    You are an intelligent reading assistant. Analyze this image of a document page.
    Break down the content into a sequential reading script.
    
    Rules:
    1. Extract text blocks in reading order.
    2. If you see a diagram, chart, or image, create a separate block typed 'visual_description'.
       - Provide a clear, detailed explanation of what the visual conveys, suitable for audio narration.
       - IMPORTANT: Provide the bounding box of the visual as 'bbox' in the format [ymin, xmin, ymax, xmax] on a scale of 0 to 1000.
    3. Do not miss any main content.
    4. Return ONLY a JSON array.

    Response Schema:
    Array<{ type: 'text' | 'visual_description', content: string, bbox?: number[] }>
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: ['text', 'visual_description'] },
              content: { type: Type.STRING },
              bbox: { 
                type: Type.ARRAY, 
                description: "Bounding box [ymin, xmin, ymax, xmax] normalized to 1000",
                items: { type: Type.INTEGER } 
              }
            },
            required: ['type', 'content']
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    const parsed = JSON.parse(text);
    return parsed.map((item: any) => ({
      ...item,
      id: Math.random().toString(36).substring(7)
    }));
  } catch (error) {
    console.error("Error analyzing page:", error);
    return [];
  }
};

// 2. Analyze HTML Content (from URL)
export const analyzeHtmlContent = async (htmlContent: string): Promise<ReadingSegment[]> => {
  const ai = createAiClient();
  
  // Truncate HTML if it's too massive to avoid token limits, though Flash context is large.
  // 100k chars is usually a safe rough limit for a simple demo.
  const safeContent = htmlContent.substring(0, 100000);

  const prompt = `
    You are an intelligent reading assistant. Analyze this HTML content from a website.
    Break down the main article or page content into a sequential reading script.
    
    Rules:
    1. Extract the main body text in reading order. IGNORE navigation menus, footers, sidebars, and ads.
    2. If you encounter an image tag with meaningful alt text or context that suggests a visual (like a chart or diagram), create a 'visual_description' block explaining it.
       - Try to extract the image 'src' URL and return it as 'imageUrl'.
    3. Return ONLY a JSON array.

    Response Schema:
    Array<{ type: 'text' | 'visual_description', content: string, imageUrl?: string }>
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { text: `HTML Content:\n${safeContent}` },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: ['text', 'visual_description'] },
              content: { type: Type.STRING },
              imageUrl: { type: Type.STRING, description: "The src URL of the image if available" }
            },
            required: ['type', 'content']
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    const parsed = JSON.parse(text);
    return parsed.map((item: any) => ({
      ...item,
      id: Math.random().toString(36).substring(7)
    }));
  } catch (error) {
    console.error("Error analyzing HTML:", error);
    return [];
  }
};

// 3. Generate Speech (TTS)
export const generateSpeech = async (text: string, audioCtx: AudioContext): Promise<AudioBuffer | null> => {
  const ai = createAiClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) return null;

    return await decodeAudioData(base64Audio, audioCtx, 24000);
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
};

// 4. Generate Image (Pro Model)
export const generateImagePro = async (
  prompt: string, 
  size: '1K' | '2K' | '4K', 
  apiKey: string // Must pass explicit key for this high-end model flow
): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey });
  
  // Size mapping if needed, but 1K/2K/4K are standard params for this model usually, 
  // or we map to specific dims. The system prompt says "Supported values are 1K, 2K, and 4K".
  
  try {
    // Note: Use generateContent for gemini-3-pro-image-preview as per system prompt instructions
    // "Call generateContent to generate images with nano banana series models" -> but 3-pro-image-preview is high quality.
    // The prompt says: "Upgrade to 'gemini-3-pro-image-preview' if the user requests high-quality images"
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1", // Defaulting to square, can be option
          imageSize: size
        }
      }
    });

    // Iterate to find image part
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;

  } catch (error) {
    console.error("Image Gen Error:", error);
    throw error;
  }
};