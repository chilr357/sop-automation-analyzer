
import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, RESPONSE_SCHEMA } from '../constants';
import type { AnalysisReport } from '../types';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const fileToGenerativePart = (base64Data: string, mimeType: string) => {
  return {
    inlineData: {
      data: base64Data,
      mimeType,
    },
  };
};

export const analyzeSOP = async (file: File): Promise<AnalysisReport> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const base64Data = dataUrl.split(',')[1];
        const pdfPart = fileToGenerativePart(base64Data, file.type);
        
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: {
              parts: [
                  { text: SYSTEM_PROMPT },
                  pdfPart
              ]
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });

        const jsonText = response.text.trim();
        const report = JSON.parse(jsonText) as AnalysisReport;
        resolve(report);
      } catch (error) {
        console.error("Error during Gemini API call:", error);
        if (error instanceof Error) {
            reject(new Error(`Failed to analyze SOP: ${error.message}`));
        } else {
            reject(new Error("An unknown error occurred during SOP analysis."));
        }
      }
    };
    reader.onerror = (error) => {
      console.error("Error reading file:", error);
      reject(new Error("Failed to read the provided file."));
    };
  });
};
