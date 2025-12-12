import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Use Gemini 1.5 Pro (It works with the Paid Key and is stable)
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-pro',
      systemInstruction: "You are a professional translator. Detect proper names (e.g., 'Jiang Chen') and keep them capitalized. Do not translate names literally."
    });

    const result = await model.generateContent(text);
    const translation = result.response.text();

    // Validate that translation exists and is a non-empty string
    if (!translation || typeof translation !== 'string' || translation.trim().length === 0) {
      console.error('Invalid translation response:', {
        hasResponse: !!result.response,
      });
      return NextResponse.json(
        { error: 'Translation API returned empty or invalid response' },
        { status: 500 }
      );
    }

    return NextResponse.json({ translation });

  } catch (error: any) {
    console.error('Translation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}