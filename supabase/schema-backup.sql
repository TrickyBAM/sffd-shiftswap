-- SFFD ShiftSwap: live schema backup extracted from Supabase project mddpdrkxexxpyneqmxfi
-- Taken 2026 07 03, right after the project was resumed from its free tier pause.
-- Purpose: disaster recovery. If the Supabase project is ever lost, this file has
-- everything needed to rebuild the database: tables, constraints, indexes, RLS
-- policies, triggers, and the full source of every RPC the app calls.
-- The function bodies below are the canonical protected code. Do not edit them here;
-- this file mirrors what is deployed in the database.

------------------------------------------------------------------------------
-- TABLES (columns as name type modifiers, one per line)
------------------------------------------------------------------------------

-- [table] matched_trades
-- columns:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   original_shift_id uuid NOT NULL
--   original_date date NOT NULL
--   return_date date NOT NULL
--   poster_id uuid NOT NULL
--   taker_id uuid NOT NULL
--   poster_name text NOT NULL
--   taker_name text NOT NULL
--   status text NOT NULL DEFAULT 'confirmed'::text
--   created_at timestamp with time zone DEFAULT now()

-- [table] notifications
-- columns:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   user_id uuid NOT NULL
--   type text NOT NULL
--   title text NOT NULL
--   message text NOT NULL
--   shift_id uuid
--   related_user_id uuid
--   read boolean DEFAULT false
--   created_at timestamp with time zone DEFAULT now()

-- [table] profiles
-- columns:
--   id uuid NOT NULL
--   full_name text NOT NULL
--   email text NOT NULL
--   rank text NOT NULL
--   position_type text NOT NULL
--   tour integer NOT NULL
--   division integer NOT NULL
--   battalion integer NOT NULL
--   station integer NOT NULL
--   phone text
--   trade_requested integer DEFAULT 0
--   trade_filled integer DEFAULT 0
--   trade_outstanding integer DEFAULT 0
--   trade_earned integer DEFAULT 0
--   profile_complete boolean DEFAULT false
--   created_at timestamp with time zone DEFAULT now()
--   updated_at timestamp with time zone DEFAULT now()

-- [table] schedules
-- columns:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   user_id uuid NOT NULL
--   work_dates date[] NOT NULL
--   gap_pattern integer[] NOT NULL
--   anchor_date date NOT NULL
--   setup_complete boolean DEFAULT false
--   created_at timestamp with time zone DEFAULT now()
--   updated_at timestamp with time zone DEFAULT now()

-- [table] shifts
-- columns:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   poster_id uuid NOT NULL
--   poster_name text NOT NULL
--   division integer NOT NULL
--   battalion integer NOT NULL
--   station integer NOT NULL
--   rank text NOT NULL
--   date date NOT NULL
--   shift_type text NOT NULL
--   status text NOT NULL DEFAULT 'open'::text
--   return_dates date[] DEFAULT '{}'::date[]
--   accept_limit_type text DEFAULT ''::text
--   coverer_id uuid
--   coverer_name text
--   notes text
--   created_at timestamp with time zone DEFAULT now()
--   updated_at timestamp with time zone DEFAULT now()

------------------------------------------------------------------------------
-- CONSTRAINTS (primary keys, foreign keys, uniques, checks)
------------------------------------------------------------------------------

-- [constraint] matched_trades.matched_trades_original_shift_id_fkey
FOREIGN KEY (original_shift_id) REFERENCES shifts(id) ON DELETE CASCADE;

-- [constraint] matched_trades.matched_trades_pkey
PRIMARY KEY (id);

-- [constraint] matched_trades.matched_trades_poster_id_fkey
FOREIGN KEY (poster_id) REFERENCES profiles(id);

-- [constraint] matched_trades.matched_trades_status_check
CHECK ((status = ANY (ARRAY['confirmed'::text, 'completed'::text])));

-- [constraint] matched_trades.matched_trades_taker_id_fkey
FOREIGN KEY (taker_id) REFERENCES profiles(id);

-- [constraint] notifications.notifications_pkey
PRIMARY KEY (id);

-- [constraint] notifications.notifications_related_user_id_fkey
FOREIGN KEY (related_user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- [constraint] notifications.notifications_shift_id_fkey
FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;

-- [constraint] notifications.notifications_type_check
CHECK ((type = ANY (ARRAY['shift_accepted'::text, 'shift_posted'::text, 'shift_filled'::text, 'swap_confirmed'::text])));

-- [constraint] notifications.notifications_user_id_fkey
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- [constraint] profiles.profiles_id_fkey
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- [constraint] profiles.profiles_pkey
PRIMARY KEY (id);

-- [constraint] profiles.profiles_position_type_check
CHECK ((position_type = ANY (ARRAY['Firefighter'::text, 'Paramedic'::text, 'Officer'::text])));

-- [constraint] profiles.profiles_rank_check
CHECK ((rank = ANY (ARRAY['Firefighter'::text, 'Paramedic'::text, 'Lieutenant'::text, 'Captain'::text, 'Battalion Chief'::text])));

-- [constraint] profiles.profiles_tour_check
CHECK (((tour >= 1) AND (tour <= 31)));

-- [constraint] schedules.schedules_pkey
PRIMARY KEY (id);

-- [constraint] schedules.schedules_user_id_fkey
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- [constraint] schedules.schedules_user_id_key
UNIQUE (user_id);

-- [constraint] shifts.shifts_accept_limit_type_check
CHECK ((accept_limit_type = ANY (ARRAY[''::text, 'station'::text, 'battalion'::text, 'division'::text])));

-- [constraint] shifts.shifts_coverer_id_fkey
FOREIGN KEY (coverer_id) REFERENCES profiles(id);

-- [constraint] shifts.shifts_pkey
PRIMARY KEY (id);

-- [constraint] shifts.shifts_poster_id_fkey
FOREIGN KEY (poster_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- [constraint] shifts.shifts_shift_type_check
CHECK ((shift_type = ANY (ARRAY['24-Hour'::text, '12-Hour Day'::text, '12-Hour Night'::text])));

-- [constraint] shifts.shifts_status_check
CHECK ((status = ANY (ARRAY['open'::text, 'covered'::text, 'cancelled'::text])));

------------------------------------------------------------------------------
-- INDEXES
------------------------------------------------------------------------------

-- [index] matched_trades_pkey
CREATE UNIQUE INDEX matched_trades_pkey ON public.matched_trades USING btree (id);

-- [index] notifications_pkey
CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);

-- [index] profiles_pkey
CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

-- [index] schedules_pkey
CREATE UNIQUE INDEX schedules_pkey ON public.schedules USING btree (id);

-- [index] schedules_user_id_key
CREATE UNIQUE INDEX schedules_user_id_key ON public.schedules USING btree (user_id);

-- [index] shifts_pkey
CREATE UNIQUE INDEX shifts_pkey ON public.shifts USING btree (id);

------------------------------------------------------------------------------
-- ROW LEVEL SECURITY STATUS
------------------------------------------------------------------------------

-- [rls] matched_trades
--   ENABLED

-- [rls] notifications
--   ENABLED

-- [rls] profiles
--   ENABLED

-- [rls] schedules
--   ENABLED

-- [rls] shifts
--   ENABLED

------------------------------------------------------------------------------
-- FUNCTIONS (includes the protected accept_shift, cancel_shift, post_shift RPCs)
------------------------------------------------------------------------------

-- [function] public.accept_shift
CREATE OR REPLACE FUNCTION public.accept_shift(p_shift_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_coverer public.profiles%rowtype;
  v_allowed boolean := false;
  v_rows integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to accept a shift';
  end if;
  if p_shift_id is null then
    raise exception 'Shift id is required';
  end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Shift not found';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'This shift was already accepted or cancelled';
  end if;
  if v_shift.poster_id = v_user_id then
    raise exception 'You cannot accept your own shift';
  end if;
  perform 1 from public.profiles
  where id in (v_shift.poster_id, v_user_id)
  order by id for update;
  select * into v_coverer from public.profiles where id = v_user_id;
  if not found then
    raise exception 'Coverer profile not found';
  end if;
  if v_coverer.profile_complete is distinct from true then
    raise exception 'Complete your profile before accepting shifts';
  end if;
  v_allowed := case coalesce(v_shift.accept_limit_type, '')
    when '' then true
    when 'station' then v_coverer.station = v_shift.station
    when 'battalion' then v_coverer.battalion = v_shift.battalion
    when 'division' then v_coverer.division = v_shift.division
    else false
  end;
  if not v_allowed then
    raise exception 'You are not eligible to accept this shift';
  end if;
  update public.shifts
  set status = 'covered', coverer_id = v_user_id, coverer_name = v_coverer.full_name
  where id = p_shift_id and status = 'open' and poster_id <> v_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Shift could not be accepted';
  end if;
  update public.profiles
  set trade_outstanding = greatest(coalesce(trade_outstanding, 0) - 1, 0),
      trade_filled = coalesce(trade_filled, 0) + 1
  where id = v_shift.poster_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Failed to update poster trade counters';
  end if;
  update public.profiles
  set trade_earned = coalesce(trade_earned, 0) + 1
  where id = v_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Failed to update coverer trade counters';
  end if;
  insert into public.notifications (user_id, type, title, message, shift_id, related_user_id)
  values (
    v_shift.poster_id, 'shift_accepted', 'Shift Covered!',
    v_coverer.full_name || ' accepted your ' || to_char(v_shift.date, 'FMMonth FMDD, YYYY') || ' shift',
    p_shift_id, v_user_id
  );
  return json_build_object('success', true, 'shift_id', p_shift_id);
end;
$function$;

-- [function] public.accept_shift
CREATE OR REPLACE FUNCTION public.accept_shift(p_shift_id uuid, p_coverer_id uuid, p_coverer_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return public.accept_shift(p_shift_id);
end;
$function$;

-- [function] public.cancel_shift
CREATE OR REPLACE FUNCTION public.cancel_shift(p_shift_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_rows integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to cancel a shift';
  end if;
  if p_shift_id is null then
    raise exception 'Shift id is required';
  end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'Shift not found';
  end if;
  if v_shift.poster_id <> v_user_id then
    raise exception 'You can only cancel your own shifts';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'Only open shifts can be cancelled';
  end if;
  update public.shifts
  set status = 'cancelled'
  where id = p_shift_id and poster_id = v_user_id and status = 'open';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Shift could not be cancelled';
  end if;
  update public.profiles
  set trade_requested = greatest(coalesce(trade_requested, 0) - 1, 0),
      trade_outstanding = greatest(coalesce(trade_outstanding, 0) - 1, 0)
  where id = v_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Failed to update trade counters';
  end if;
  return json_build_object('success', true, 'shift_id', p_shift_id);
end;
$function$;

-- [function] public.handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, rank, position_type, tour,
    division, battalion, station, profile_complete,
    trade_requested, trade_filled, trade_outstanding, trade_earned
  ) VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'Firefighter',
    'Firefighter',
    1, 2, 1, 2, FALSE,
    0, 0, 0, 0
  );
  RETURN NEW;
END;
$function$;

-- [function] public.post_shift
CREATE OR REPLACE FUNCTION public.post_shift(p_date date, p_shift_type text, p_notes text DEFAULT NULL::text, p_return_dates date[] DEFAULT '{}'::date[], p_accept_limit_type text DEFAULT ''::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_shift_id uuid;
  v_rows integer;
  v_return_dates date[] := coalesce(p_return_dates, '{}'::date[]);
  v_accept_limit_type text := coalesce(p_accept_limit_type, '');
begin
  if v_user_id is null then
    raise exception 'You must be signed in to post a shift';
  end if;
  if p_date is null then
    raise exception 'Shift date is required';
  end if;
  if p_shift_type is null or p_shift_type not in ('24-Hour', '12-Hour Day', '12-Hour Night') then
    raise exception 'Invalid shift type';
  end if;
  if v_accept_limit_type not in ('', 'station', 'battalion', 'division') then
    raise exception 'Invalid accept limit';
  end if;
  if exists (select 1 from unnest(v_return_dates) as d(value) where value is null) then
    raise exception 'Return dates cannot contain null values';
  end if;
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if v_profile.profile_complete is distinct from true then
    raise exception 'Complete your profile before posting shifts';
  end if;
  insert into public.shifts (
    poster_id, poster_name, division, battalion, station, rank,
    date, shift_type, status, return_dates, accept_limit_type, notes
  ) values (
    v_user_id, v_profile.full_name, v_profile.division, v_profile.battalion, v_profile.station, v_profile.rank,
    p_date, p_shift_type, 'open', v_return_dates, v_accept_limit_type, nullif(trim(coalesce(p_notes, '')), '')
  ) returning id into v_shift_id;
  update public.profiles
  set trade_requested = coalesce(trade_requested, 0) + 1,
      trade_outstanding = coalesce(trade_outstanding, 0) + 1
  where id = v_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Failed to update trade counters';
  end if;
  return json_build_object('success', true, 'shift_id', v_shift_id);
end;
$function$;

-- [function] public.update_updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

------------------------------------------------------------------------------
-- TRIGGERS
------------------------------------------------------------------------------

-- [trigger] profiles.update_profiles_updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- [trigger] schedules.update_schedules_updated_at
CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- [trigger] shifts.update_shifts_updated_at
CREATE TRIGGER update_shifts_updated_at BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- [trigger] users.on_auth_user_created
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

------------------------------------------------------------------------------
-- RLS POLICIES
------------------------------------------------------------------------------

-- [policy] matched_trades.Involved users can view matched trades
CREATE POLICY "Involved users can view matched trades" ON public.matched_trades AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = poster_id) OR (auth.uid() = taker_id)));

-- [policy] matched_trades.Taker can create matched trade
CREATE POLICY "Taker can create matched trade" ON public.matched_trades AS PERMISSIVE FOR INSERT TO public USING (true) WITH CHECK ((auth.uid() = taker_id));

-- [policy] notifications.Authenticated users can create notifications
CREATE POLICY "Authenticated users can create notifications" ON public.notifications AS PERMISSIVE FOR INSERT TO public USING (true) WITH CHECK ((auth.uid() IS NOT NULL));

-- [policy] notifications.Users can delete own notifications
CREATE POLICY "Users can delete own notifications" ON public.notifications AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

-- [policy] notifications.Users can update own notifications
CREATE POLICY "Users can update own notifications" ON public.notifications AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

-- [policy] notifications.Users can view own notifications
CREATE POLICY "Users can view own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

-- [policy] profiles.Users can insert own profile
CREATE POLICY "Users can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO public USING (true) WITH CHECK ((auth.uid() = id));

-- [policy] profiles.Users can update own profile
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = id));

-- [policy] profiles.Users can view all profiles
CREATE POLICY "Users can view all profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING (true);

-- [policy] schedules.Users can insert own schedule
CREATE POLICY "Users can insert own schedule" ON public.schedules AS PERMISSIVE FOR INSERT TO public USING (true) WITH CHECK ((auth.uid() = user_id));

-- [policy] schedules.Users can update own schedule
CREATE POLICY "Users can update own schedule" ON public.schedules AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

-- [policy] schedules.Users can view own schedule
CREATE POLICY "Users can view own schedule" ON public.schedules AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

-- [policy] shifts.Anyone can view shifts
CREATE POLICY "Anyone can view shifts" ON public.shifts AS PERMISSIVE FOR SELECT TO public USING (true);

-- [policy] shifts.Authenticated users can create shifts
CREATE POLICY "Authenticated users can create shifts" ON public.shifts AS PERMISSIVE FOR INSERT TO public USING (true) WITH CHECK ((auth.uid() = poster_id));

-- [policy] shifts.Poster can delete own shift
CREATE POLICY "Poster can delete own shift" ON public.shifts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = poster_id));

-- [policy] shifts.Poster can update own shift
CREATE POLICY "Poster can update own shift" ON public.shifts AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = poster_id)) WITH CHECK ((auth.uid() = poster_id));

------------------------------------------------------------------------------
-- ROW COUNTS AT BACKUP TIME (2026 07 03)
------------------------------------------------------------------------------

-- [count] auth.users
--   5

-- [count] matched_trades
--   0

-- [count] notifications
--   0

-- [count] profiles
--   5

-- [count] schedules
--   0

-- [count] shifts
--   8
