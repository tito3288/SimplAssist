BEGIN;

CREATE TABLE public.waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  feature_interest text,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  unsubscribed_at timestamptz,
  launch_send_claim_token uuid,
  launch_send_claimed_at timestamptz,

  CONSTRAINT waitlist_signups_email_normalized
    CHECK (
      email = lower(btrim(email))
      AND char_length(email) BETWEEN 3 AND 320
    ),
  CONSTRAINT waitlist_signups_email_unique UNIQUE (email),
  CONSTRAINT waitlist_signups_launch_claim_shape
    CHECK (
      (
        launch_send_claim_token IS NULL
        AND launch_send_claimed_at IS NULL
      )
      OR
      (
        launch_send_claim_token IS NOT NULL
        AND launch_send_claimed_at IS NOT NULL
      )
    )
);

CREATE INDEX waitlist_signups_created_at_idx
  ON public.waitlist_signups (created_at DESC);

CREATE INDEX waitlist_signups_pending_idx
  ON public.waitlist_signups (created_at, id)
  WHERE notified_at IS NULL AND unsubscribed_at IS NULL;

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.waitlist_signups
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.waitlist_signups
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_waitlist_launch_send(
  p_signup_id uuid,
  p_claim_token uuid
)
RETURNS TABLE(signup_id uuid, signup_email text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_signup_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'signup id and claim token are required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.waitlist_signups AS signup
  SET
    launch_send_claim_token = p_claim_token,
    launch_send_claimed_at = clock_timestamp()
  WHERE signup.id = p_signup_id
    AND signup.notified_at IS NULL
    AND signup.unsubscribed_at IS NULL
    AND signup.launch_send_claim_token IS NULL
  RETURNING signup.id, signup.email;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_waitlist_launch_send(
  p_signup_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id uuid;
BEGIN
  IF p_signup_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'signup id and claim token are required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.waitlist_signups AS signup
  SET
    notified_at = clock_timestamp(),
    launch_send_claim_token = NULL,
    launch_send_claimed_at = NULL
  WHERE signup.id = p_signup_id
    AND signup.notified_at IS NULL
    AND signup.launch_send_claim_token = p_claim_token
  RETURNING signup.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_waitlist_launch_send(
  p_signup_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id uuid;
BEGIN
  IF p_signup_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'signup id and claim token are required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.waitlist_signups AS signup
  SET
    launch_send_claim_token = NULL,
    launch_send_claimed_at = NULL
  WHERE signup.id = p_signup_id
    AND signup.notified_at IS NULL
    AND signup.launch_send_claim_token = p_claim_token
  RETURNING signup.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION
  public.claim_waitlist_launch_send(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.complete_waitlist_launch_send(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.release_waitlist_launch_send(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.claim_waitlist_launch_send(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.complete_waitlist_launch_send(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.release_waitlist_launch_send(uuid, uuid)
  TO service_role;

COMMIT;
