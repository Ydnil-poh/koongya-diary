-- 1. koongyas 테이블 (활성 쿵야 그리드 상태 저장)
CREATE TABLE IF NOT EXISTS public.koongyas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    grid_index INTEGER NOT NULL CHECK (grid_index >= 0 AND grid_index <= 8),
    type TEXT NOT NULL,
    current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step >= 1 AND current_step <= 5),
    chat_logs JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, grid_index)
);

-- 2. archives 테이블 (졸업 사진 및 정보 저장)
CREATE TABLE IF NOT EXISTS public.archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    graduation_question TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Row Level Security (RLS) 설정
ALTER TABLE public.koongyas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archives ENABLE ROW LEVEL SECURITY;

-- 정책: 자신의 데이터만 조회 및 수정 가능
CREATE POLICY "Users can manage their own koongyas" 
ON public.koongyas FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own archives" 
ON public.archives FOR ALL 
USING (auth.uid() = user_id);
