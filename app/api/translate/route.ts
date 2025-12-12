import { VertexAI } from '@google-cloud/vertexai';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    const vertex_ai = new VertexAI({
      project: 'thermal-setup-473518-e9',
      location: 'us-central1',
      googleAuthOptions: {
        keyFilename: path.join(process.cwd(), 'service-account.json')
      }
    });

    // Use gemini-2.5-pro for high-reasoning tasks (December 2025 GA standard)
    const model = vertex_ai.getGenerativeModel({
      model: 'gemini-2.5-pro',
      systemInstruction: {
        role: 'system',
        parts: [{
          text: 'You are a professional translator. Use your deep reasoning capabilities to detect proper names (e.g., Jiang Chen) and preserve them. Do not translate them literally.'
        }]
      }
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text }] }],
    });

    const response = await result.response;
    const translation = response.candidates?.[0]?.content?.parts?.[0]?.text;

    return NextResponse.json({ translation });

  } catch (error: any) {
    console.error('Translation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}