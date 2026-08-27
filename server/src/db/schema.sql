-- 보드게임 멀티 — 스키마
--
-- Supabase 무료 플랜은 사람당 프로젝트 2개까지라, 새 프로젝트를 만드는 대신
-- 기존 프로젝트 안에 이 스키마 하나를 따로 둔다. 나중에 떼어낼 땐
--   pg_dump -n boardgame ...
-- 로 통째로 옮길 수 있다.
--
-- 실행: Supabase 대시보드 → SQL Editor 에 붙여넣고 실행

create schema if not exists boardgame;
create extension if not exists citext with schema public;

-- ── 계정 ──────────────────────────────────────────────────────
--
-- 이메일을 받지 않는다. 비밀번호를 잊으면 계정을 되찾을 수 없고, 그게 의도된 선택이다.
-- 대신 개인정보를 하나도 들고 있지 않으므로 유출될 것도 없다.

create table if not exists boardgame.users (
  id            uuid primary key default gen_random_uuid(),
  -- citext = 대소문자를 구분하지 않는 텍스트. Riro 와 riro 가 같은 아이디가 된다.
  username      citext not null unique,
  -- scrypt 결과. 원문은 서버도 모른다.
  password_hash text not null,
  nickname      text not null,
  -- 닉네임은 중복을 허용하되 화면에서 구분되도록 꼬리표를 붙인다 (리로#4821)
  tag           char(4) not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  is_banned     boolean not null default false,
  ban_reason    text
);

create index if not exists users_last_seen_idx on boardgame.users (last_seen_at desc);

-- ── 로그인 세션 ────────────────────────────────────────────────
--
-- 토큰 원문은 저장하지 않는다. 클라이언트가 보내온 토큰을 해시해서 대조한다.
-- DB 가 통째로 새도 남의 계정으로 로그인할 수는 없다.

create table if not exists boardgame.auth_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references boardgame.users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- 원문 IP 는 저장하지 않는다. 같은 사람인지 세는 용도로만 쓴다.
  ip_hash     text
);

create index if not exists auth_sessions_user_idx on boardgame.auth_sessions (user_id);
create index if not exists auth_sessions_expiry_idx on boardgame.auth_sessions (expires_at);

-- ── 접속 기록 (DAU 의 원천) ────────────────────────────────────
--
-- 게스트도 남긴다. 계정이 없어도 "몇 명이 왔는지" 는 세야 하기 때문이다.
-- 다만 게스트는 브라우저가 바뀌면 다른 사람으로 잡힌다 — 이 한계를 알고 봐야 한다.

create table if not exists boardgame.visits (
  id             bigserial primary key,
  user_id        uuid references boardgame.users(id) on delete set null,
  -- 게스트 식별용 임의 키 (브라우저에 저장). 계정이 있으면 null
  guest_key      text,
  connected_at   timestamptz not null default now(),
  disconnected_at timestamptz,
  ip_hash        text,
  user_agent     text
);

create index if not exists visits_connected_idx on boardgame.visits (connected_at desc);
create index if not exists visits_user_idx on boardgame.visits (user_id);

-- ── 판 기록 ────────────────────────────────────────────────────
--
-- 방(Redis)은 몇 분 뒤 사라지지만 이건 남는다. 지우지 않는다.
-- 수익화 판단에 정말 필요한 건 "몇 명이 왔나" 가 아니라
-- **시작한 판 중 몇 판이 끝까지 갔나** 라서, 중단도 똑같이 기록한다.

create type boardgame.game_outcome as enum (
  'finished',        -- 정상 종료
  'aborted_by_host', -- 방장이 끝냄
  'abandoned',       -- 전원 이탈
  'expired'          -- 아무도 안 돌아와서 만료
);

create table if not exists boardgame.games (
  id            bigserial primary key,
  room_code     text not null,
  game          text not null check (game in ('tichu', 'skullking')),
  is_public     boolean not null,
  options       jsonb not null default '{}'::jsonb,
  human_count   int not null,
  bot_count     int not null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  outcome       boardgame.game_outcome,
  -- 중단됐다면 몇 라운드에서 멈췄는지 — 완주율을 라운드별로 볼 수 있다
  ended_round   int,
  -- 분쟁 확인·다시보기용 최종 상태. 용량이 부담되면 나중에 오래된 것부터 비운다.
  final_state   jsonb
);

create index if not exists games_started_idx on boardgame.games (started_at desc);
create index if not exists games_outcome_idx on boardgame.games (outcome);

create table if not exists boardgame.game_players (
  game_id        bigint not null references boardgame.games(id) on delete cascade,
  seat           int not null,
  -- 계정으로 들어온 사람만 채워진다. 게스트는 null 이고 전적이 쌓이지 않는다.
  user_id        uuid references boardgame.users(id) on delete set null,
  display_name   text not null,
  is_bot         boolean not null default false,
  team           int,          -- 티츄만 (0/1)
  score          int,
  placement      int,          -- 1등, 2등…
  is_winner      boolean,
  -- 판이 끝나기 전에 나갔는가. 먹튀를 세는 근거.
  left_early     boolean not null default false,
  left_at_round  int,
  primary key (game_id, seat)
);

create index if not exists game_players_user_idx on boardgame.game_players (user_id);

-- ── 방 생명주기 이벤트 ─────────────────────────────────────────
--
-- 판이 시작조차 못 한 방도 세야 한다. "방을 만들었는데 사람이 안 모여서 접었다" 가
-- 얼마나 흔한지가 공개 로비의 성패를 가른다.

create table if not exists boardgame.room_events (
  id         bigserial primary key,
  room_code  text not null,
  -- created / started / ended / expired ...
  kind       text not null,
  game       text,
  is_public  boolean,
  at         timestamptz not null default now(),
  detail     jsonb
);

create index if not exists room_events_at_idx on boardgame.room_events (at desc);
create index if not exists room_events_kind_idx on boardgame.room_events (kind, at desc);

-- ── 관리자용 집계 뷰 ───────────────────────────────────────────

-- 하루에 몇 명이 왔나 (계정 + 게스트)
create or replace view boardgame.daily_visitors as
select
  (connected_at at time zone 'Asia/Seoul')::date       as day,
  count(distinct coalesce(user_id::text, guest_key))    as visitors,
  count(distinct user_id)                               as members,
  count(*)                                              as connections
from boardgame.visits
group by 1
order by 1 desc;

-- 하루에 몇 판이 시작되고 몇 판이 끝까지 갔나
-- **완주율이 이 서비스의 생사를 가르는 지표다.**
create or replace view boardgame.daily_games as
select
  (started_at at time zone 'Asia/Seoul')::date as day,
  game,
  is_public,
  count(*)                                                       as started,
  count(*) filter (where outcome = 'finished')                   as finished,
  round(
    100.0 * count(*) filter (where outcome = 'finished')
    / nullif(count(*) filter (where outcome is not null), 0)
  , 1)                                                           as finish_rate_pct,
  round(avg(
    extract(epoch from (ended_at - started_at)) / 60
  ) filter (where outcome = 'finished')::numeric, 1)             as avg_minutes
from boardgame.games
group by 1, 2, 3
order by 1 desc;

-- 방을 만들었는데 시작까지 갔나 — 콜드스타트(사람이 안 모임)가 얼마나 심각한지
create or replace view boardgame.daily_room_funnel as
select
  (at at time zone 'Asia/Seoul')::date          as day,
  is_public,
  count(*) filter (where kind = 'created')      as rooms_created,
  count(*) filter (where kind = 'started')      as rooms_started,
  round(
    100.0 * count(*) filter (where kind = 'started')
    / nullif(count(*) filter (where kind = 'created'), 0)
  , 1)                                          as start_rate_pct
from boardgame.room_events
group by 1, 2
order by 1 desc;

-- 계정별 전적 (게스트로 한 판은 잡히지 않는다)
create or replace view boardgame.user_records as
select
  u.id, u.username, u.nickname, u.tag,
  count(gp.*)                                       as games,
  count(*) filter (where gp.is_winner)              as wins,
  count(*) filter (where gp.left_early)             as quits,
  max(g.started_at)                                 as last_played_at
from boardgame.users u
left join boardgame.game_players gp on gp.user_id = u.id
left join boardgame.games g on g.id = gp.game_id and g.outcome = 'finished'
group by u.id, u.username, u.nickname, u.tag;

-- ── 접근 차단 ──────────────────────────────────────────────────
--
-- 이 테이블들은 **게임 서버만** 직접 연결로 읽고 쓴다. 브라우저는 Supabase 를 모른다.
-- 그래도 RLS 를 켜고 정책을 하나도 두지 않아, 혹시 anon 키가 새더라도
-- 아무것도 읽히지 않게 막아 둔다. (서버의 직접 연결은 RLS 를 통과한다)

alter table boardgame.users         enable row level security;
alter table boardgame.auth_sessions enable row level security;
alter table boardgame.visits        enable row level security;
alter table boardgame.games         enable row level security;
alter table boardgame.game_players  enable row level security;
alter table boardgame.room_events   enable row level security;
