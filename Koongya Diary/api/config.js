// Vercel Serverless Function: 비밀 키를 안전하게 전달합니다.
export default function handler(request, response) {
  response.status(200).json({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  });
}
