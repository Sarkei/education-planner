import pg from 'pg';

export const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'db',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'edu',
  password: process.env.POSTGRES_PASSWORD || 'edu',
  database: process.env.POSTGRES_DB || 'education',
  max: 10,
});

/** Schema ist idempotent — jede Änderung als add column if not exists ergänzen. */
export async function initDb(): Promise<void> {
  await pool.query(`
    create table if not exists users (
      id serial primary key,
      email text not null unique,
      name text not null,
      password_hash text not null,
      role text not null default 'user',
      token_version integer not null default 0,
      created_at timestamptz not null default now()
    );

    create table if not exists password_resets (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      token_hash text not null,
      expires_at timestamptz not null,
      used_at timestamptz
    );

    create table if not exists nodes (
      id uuid primary key,
      parent_id uuid references nodes(id) on delete set null,
      name text not null,
      kind text not null check (kind in ('folder','file')),
      storage_path text not null,
      mime text,
      size bigint not null default 0,
      version integer not null default 1,
      owner_id integer not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      trashed_at timestamptz,
      trashed_from uuid,
      position integer not null default 0
    );

    create index if not exists nodes_parent_idx on nodes(parent_id) where trashed_at is null;
    create index if not exists nodes_owner_idx on nodes(owner_id);

    create table if not exists shares (
      id serial primary key,
      node_id uuid not null references nodes(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      permission text not null check (permission in ('view','edit')),
      created_at timestamptz not null default now(),
      unique (node_id, user_id)
    );

    create table if not exists file_versions (
      id serial primary key,
      node_id uuid not null references nodes(id) on delete cascade,
      version integer not null,
      storage_path text not null,
      size bigint not null default 0,
      created_by integer references users(id) on delete set null,
      created_at timestamptz not null default now()
    );

    create table if not exists upload_sessions (
      id uuid primary key,
      user_id integer not null references users(id) on delete cascade,
      parent_id uuid references nodes(id) on delete set null,
      name text not null,
      mime text,
      size bigint not null default 0,
      chunks integer not null default 0,
      created_at timestamptz not null default now()
    );

    create table if not exists office_sessions (
      node_id uuid primary key references nodes(id) on delete cascade,
      doc_key text not null,
      updated_at timestamptz not null default now()
    );
    alter table office_sessions add column if not exists last_saved_at timestamptz;
    alter table office_sessions add column if not exists last_status integer;
  `);
}
