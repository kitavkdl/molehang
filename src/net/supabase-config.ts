/**
 * Supabase 접속 정보.
 *
 * 여기 키는 **publishable(anon) 키**라 저장소에 들어가도 된다 —
 * 데이터 보호는 키가 아니라 RLS 정책이 한다. (모든 테이블에 "자기 행만" 정책이 걸려 있다)
 * 절대 service_role 키를 여기 넣지 말 것.
 *
 * 프로젝트: molehang (ap-northeast-2)
 * 스키마: profiles / saves — 마이그레이션 `create_saves_and_profiles`
 */
export const SUPABASE = {
  url: 'https://otgrxwchxguahdoxawsz.supabase.co',
  publishableKey: 'sb_publishable_fY7ZriokvJh-8GkZfhgSXg_QUzfwobM',
} as const;

/**
 * 아직 클라이언트 연결은 붙이지 않았다.
 * 다음 단계에서 `@supabase/supabase-js` 를 추가하고
 * `MolehangGateway` 의 Supabase 구현체(`SupabaseGateway`)를 여기에 얹는다.
 * 게이트웨이 인터페이스는 그대로라 UI·씬 코드는 바뀌지 않는다. (CLAUDE.md §5)
 */
