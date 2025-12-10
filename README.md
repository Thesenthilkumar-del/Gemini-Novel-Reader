# Gemini Novel Reader

A Next.js application that translates novels using Google's Gemini AI. Simply provide a URL to a novel, and the app will scrape the content and translate it to English while preserving the narrative flow and formatting.

## Features

- **Clean UI**: Centered interface with URL input and translate button
- **Content Scraping**: Automatically fetches content from any URL using Jina.ai
- **AI Translation**: Uses Google Gemini 1.5 Flash model for high-quality translations
- **Chunking**: Handles long texts by splitting them into manageable chunks
- **Split View**: Side-by-side display of original and translated content
- **Paper-like Design**: Cream background with serif font (Merriweather) for a reading experience

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Google Generative AI SDK
- React Markdown
- Lucide React

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file in the root directory:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a URL to a novel in the input field
2. Click "Translate"
3. The app will fetch the content, translate it, and display both versions side-by-side

## API Route

The `/api/translate` endpoint handles the translation:
- Accepts POST requests with `{ content: string }`
- Uses Gemini 1.5 Flash model
- Automatically chunks content over 10,000 characters
- Returns `{ translated: string }`

