BEGIN;

-- ---------------------------------------------------------------------------
-- Phone-number provider identity and paid-order provenance
-- ---------------------------------------------------------------------------

-- Keep telnyx_phone_number_id in place during the additive rollout. New code
-- gives that legacy column one unambiguous meaning: the decimal-string ID of
-- the owned /phone_numbers resource. The two UUIDs below are provenance only
-- and must never be sent to /phone_numbers/{id}.
ALTER TABLE public.phone_numbers
  ADD COLUMN telnyx_number_order_phone_number_id uuid,
  ADD COLUMN telnyx_number_order_id uuid;

COMMENT ON COLUMN public.phone_numbers.telnyx_phone_number_id IS
  'Telnyx owned /phone_numbers resource ID as a decimal string. Legacy rows may temporarily retain a number-order UUID until guarded reconciliation.';

COMMENT ON COLUMN public.phone_numbers.telnyx_number_order_phone_number_id IS
  'Nullable UUID of the Telnyx number_order_phone_number child. Provenance only; never valid for /phone_numbers/{id}.';

COMMENT ON COLUMN public.phone_numbers.telnyx_number_order_id IS
  'Nullable UUID of the Telnyx number_order. Provenance and paid-order retry fence only; never valid for /phone_numbers/{id}.';

-- Every UUID written by the pre-055 purchase path came from
-- number_order.data.phone_numbers[0].id. Preserve that child identity before
-- application code begins replacing the legacy column with the owned numeric
-- resource ID. The order-level UUID cannot be inferred retrospectively.
UPDATE public.phone_numbers
SET telnyx_number_order_phone_number_id =
      lower(btrim(telnyx_phone_number_id))::uuid
WHERE telnyx_number_order_phone_number_id IS NULL
  AND telnyx_phone_number_id ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

CREATE UNIQUE INDEX
  phone_numbers_telnyx_number_order_phone_number_id_unique
ON public.phone_numbers (telnyx_number_order_phone_number_id)
WHERE telnyx_number_order_phone_number_id IS NOT NULL;

-- An order can contain multiple phone-number children, so this index is
-- intentionally non-unique.
CREATE INDEX phone_numbers_telnyx_number_order_id_idx
ON public.phone_numbers (telnyx_number_order_id)
WHERE telnyx_number_order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Managed-resource identity shape
-- ---------------------------------------------------------------------------

-- Migration 034 created this CHECK without a stable name. Locate the exact
-- phone-number provider-ID check through the catalog and refuse to guess if
-- the schema no longer has exactly one matching constraint. Also refuse to
-- reinterpret a UUID that has already been marked releaseable or released:
-- that attestation belongs to the wrong Telnyx resource namespace and needs
-- operator review, not an automatic migration rewrite.
DO $migration_055_phone_provider_check$
DECLARE
  v_constraint_names name[];
BEGIN
  SELECT array_agg(constraint_row.conname ORDER BY constraint_row.conname)
  INTO v_constraint_names
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid =
          'public.telnyx_managed_resources'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid)
          LIKE '%resource_type <> ''phone_number''::text%'
    AND pg_get_constraintdef(constraint_row.oid)
          LIKE '%provider_id ~*%';

  IF COALESCE(cardinality(v_constraint_names), 0) <> 1 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'migration_055_expected_one_legacy_phone_provider_check_found_%s',
        COALESCE(cardinality(v_constraint_names), 0)
      ),
      ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.telnyx_managed_resources AS resource
    WHERE resource.resource_type = 'phone_number'
      AND resource.provider_id IS NOT NULL
      AND NOT (
        resource.provider_id ~ '^[0-9]+$'
        OR (
          resource.ownership_state = 'unverified_hold'
          AND resource.provider_id ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'migration_055_unsafe_phone_provider_identity_requires_review'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.telnyx_managed_resources DROP CONSTRAINT %I',
    v_constraint_names[1]
  );
END;
$migration_055_phone_provider_check$;

ALTER TABLE public.telnyx_managed_resources
  ADD CONSTRAINT telnyx_managed_resources_phone_provider_id_shape_check
  CHECK (
    resource_type <> 'phone_number'
    OR provider_id IS NULL
    OR provider_id ~ '^[0-9]+$'
    OR (
      ownership_state = 'unverified_hold'
      AND provider_id ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  ) NOT VALID;

ALTER TABLE public.telnyx_managed_resources
  VALIDATE CONSTRAINT
    telnyx_managed_resources_phone_provider_id_shape_check;

-- The migration-034 snapshot function predates owned numeric IDs and maps
-- every non-UUID phone pointer to NULL. Correct only that future insert shape
-- at the registry boundary; explicit provider IDs and legacy UUID/stale rows
-- retain their existing behavior.
CREATE FUNCTION public.fill_telnyx_phone_managed_resource_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone public.phone_numbers%ROWTYPE;
BEGIN
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = NEW.business_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telnyx_phone_managed_resource_business_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT phone.*
  INTO v_phone
  FROM public.phone_numbers AS phone
  WHERE phone.id = NEW.phone_number_id
    AND phone.business_id = NEW.business_id
  FOR SHARE;

  IF NOT FOUND
     OR NEW.canonical_e164 IS DISTINCT FROM v_phone.phone_number THEN
    RAISE EXCEPTION 'telnyx_phone_managed_resource_target_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF v_phone.telnyx_phone_number_id ~ '^[0-9]+$' THEN
    NEW.provider_id := v_phone.telnyx_phone_number_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER fill_telnyx_phone_managed_resource_id
BEFORE INSERT ON public.telnyx_managed_resources
FOR EACH ROW
WHEN (
  NEW.resource_type = 'phone_number'
  AND NEW.phone_number_id IS NOT NULL
  AND NEW.provider_id IS NULL
)
EXECUTE FUNCTION public.fill_telnyx_phone_managed_resource_id();

-- ---------------------------------------------------------------------------
-- Guarded legacy-ID reconciliation
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.repair_telnyx_phone_number_resource_id(
  p_business_id uuid,
  p_phone_number_id uuid,
  p_phone_number text,
  p_expected_legacy_id text,
  p_resolved_resource_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_phone public.phone_numbers%ROWTYPE;
  v_resource public.telnyx_managed_resources%ROWTYPE;
  v_resource_ids uuid[];
  v_expected_uuid uuid;
  v_expected_is_child boolean := false;
  v_active_phone_count integer;
  v_changed integer;
BEGIN
  IF p_business_id IS NULL OR p_phone_number_id IS NULL THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_identity_required'
      USING ERRCODE = '22004';
  END IF;

  IF p_phone_number IS NULL
     OR p_phone_number !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_invalid_e164'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_legacy_id IS NULL
     OR p_expected_legacy_id <> lower(btrim(p_expected_legacy_id))
     OR p_expected_legacy_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_invalid_legacy_id'
      USING ERRCODE = '22023';
  END IF;

  IF p_resolved_resource_id IS NULL
     OR p_resolved_resource_id !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_invalid_resource_id'
      USING ERRCODE = '22023';
  END IF;

  v_expected_uuid := p_expected_legacy_id::uuid;

  -- Lock in the same broad-to-narrow order used by assignment and release:
  -- business, phone row, then managed-resource row.
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_business.deleted_at IS NOT NULL
     OR v_business.deletion_scheduled_for IS NOT NULL
     OR v_business.operations_suspended_at IS NOT NULL
     OR v_business.telnyx_unique_claims_released_at IS NOT NULL
     OR v_business.active_telnyx_release_run_id IS NOT NULL
     OR v_business.telnyx_resource_state NOT IN ('provisioning', 'active') THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.telnyx_campaign_assignment_claim_token IS NOT NULL
     AND v_business.telnyx_campaign_assignment_claimed_at IS NOT NULL
     AND v_business.telnyx_campaign_assignment_claimed_at >=
           clock_timestamp() - interval '60 seconds' THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_assignment_claim_active'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer
  INTO v_active_phone_count
  FROM public.phone_numbers AS phone
  WHERE phone.business_id = p_business_id
    AND phone.is_active IS TRUE
    AND phone.resource_status = 'active';

  IF v_active_phone_count <> 1 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'telnyx_phone_number_repair_active_phone_count_%s',
        v_active_phone_count
      ),
      ERRCODE = '23514';
  END IF;

  SELECT phone.*
  INTO v_phone
  FROM public.phone_numbers AS phone
  WHERE phone.id = p_phone_number_id
    AND phone.business_id = p_business_id
    AND phone.phone_number = p_phone_number
    AND phone.is_active IS TRUE
    AND phone.resource_status = 'active'
    AND phone.released_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_target_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF v_phone.telnyx_phone_number_id IS DISTINCT FROM p_expected_legacy_id
     AND v_phone.telnyx_phone_number_id IS DISTINCT FROM
           p_resolved_resource_id THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_pointer_mismatch'
      USING ERRCODE = '23514';
  END IF;

  -- A new charged-order fence can contain only the parent order UUID when the
  -- child was absent from Telnyx's response. Do not mislabel that parent UUID
  -- as a child. Rows with neither provenance column are the known pre-055
  -- shape, where the legacy pointer was always the child UUID.
  IF v_phone.telnyx_number_order_phone_number_id IS NOT NULL THEN
    IF v_phone.telnyx_number_order_phone_number_id IS DISTINCT FROM
         v_expected_uuid THEN
      RAISE EXCEPTION 'telnyx_phone_number_repair_provenance_mismatch'
        USING ERRCODE = '23514';
    END IF;
    v_expected_is_child := true;
  ELSIF v_phone.telnyx_number_order_id IS NOT NULL
        AND v_phone.telnyx_number_order_id = v_expected_uuid THEN
    v_expected_is_child := false;
  ELSIF v_phone.telnyx_phone_number_id = p_expected_legacy_id THEN
    v_expected_is_child := true;
  ELSE
    RAISE EXCEPTION 'telnyx_phone_number_repair_provenance_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.phone_numbers AS conflicting_phone
    WHERE conflicting_phone.id <> p_phone_number_id
      AND conflicting_phone.is_active IS TRUE
      AND conflicting_phone.telnyx_phone_number_id =
            p_resolved_resource_id
  ) THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_resource_id_conflict'
      USING ERRCODE = '23505';
  END IF;

  SELECT array_agg(resource.id ORDER BY resource.id)
  INTO v_resource_ids
  FROM public.telnyx_managed_resources AS resource
  WHERE resource.resource_type = 'phone_number'
    AND (
      resource.phone_number_id = p_phone_number_id
      OR (
        resource.local_claim_active IS TRUE
        AND resource.ownership_state <> 'released'
        AND resource.canonical_e164 = p_phone_number
      )
    );

  IF COALESCE(cardinality(v_resource_ids), 0) > 1 THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_multiple_registry_rows'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(cardinality(v_resource_ids), 0) = 1 THEN
    SELECT resource.*
    INTO v_resource
    FROM public.telnyx_managed_resources AS resource
    WHERE resource.id = v_resource_ids[1]
    FOR UPDATE;

    IF v_resource.business_id IS DISTINCT FROM p_business_id
       OR v_resource.phone_number_id IS DISTINCT FROM p_phone_number_id
       OR v_resource.canonical_e164 IS DISTINCT FROM p_phone_number
       OR v_resource.local_claim_active IS NOT TRUE
       OR v_resource.ownership_state <> 'unverified_hold'
       OR (
         v_resource.provider_id IS NOT NULL
         AND v_resource.provider_id <> p_expected_legacy_id
         AND v_resource.provider_id <> p_resolved_resource_id
       ) THEN
      RAISE EXCEPTION 'telnyx_phone_number_repair_registry_mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.telnyx_managed_resources AS conflicting_resource
    WHERE conflicting_resource.resource_type = 'phone_number'
      AND conflicting_resource.local_claim_active IS TRUE
      AND conflicting_resource.ownership_state <> 'released'
      AND conflicting_resource.provider_id = p_resolved_resource_id
      AND (
        COALESCE(cardinality(v_resource_ids), 0) = 0
        OR conflicting_resource.id <> v_resource_ids[1]
      )
  ) THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_registry_id_conflict'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.telnyx_resource_release_actions AS action
    WHERE action.phone_number_id = p_phone_number_id
       OR (
         COALESCE(cardinality(v_resource_ids), 0) = 1
         AND action.managed_resource_id = v_resource_ids[1]
       )
  ) THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_release_history_exists'
      USING ERRCODE = '55000';
  END IF;

  -- No normal return is reachable after the first write. Any unexpected CAS
  -- or registry failure raises and rolls the whole function call back.
  UPDATE public.phone_numbers AS phone
  SET telnyx_phone_number_id = p_resolved_resource_id,
      telnyx_number_order_phone_number_id = CASE
        WHEN v_expected_is_child THEN v_expected_uuid
        ELSE phone.telnyx_number_order_phone_number_id
      END
  WHERE phone.id = p_phone_number_id
    AND phone.business_id = p_business_id
    AND phone.phone_number = p_phone_number
    AND phone.is_active IS TRUE
    AND phone.resource_status = 'active'
    AND phone.released_at IS NULL
    AND phone.telnyx_phone_number_id IS NOT DISTINCT FROM
          v_phone.telnyx_phone_number_id
    AND phone.telnyx_number_order_phone_number_id IS NOT DISTINCT FROM
          v_phone.telnyx_number_order_phone_number_id
    AND phone.telnyx_number_order_id IS NOT DISTINCT FROM
          v_phone.telnyx_number_order_id;

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'telnyx_phone_number_repair_phone_cas_lost'
      USING ERRCODE = '40001';
  END IF;

  IF COALESCE(cardinality(v_resource_ids), 0) = 1 THEN
    UPDATE public.telnyx_managed_resources AS resource
    SET provider_id = p_resolved_resource_id,
        updated_at = now()
    WHERE resource.id = v_resource.id
      AND resource.business_id = p_business_id
      AND resource.phone_number_id = p_phone_number_id
      AND resource.resource_type = 'phone_number'
      AND resource.canonical_e164 = p_phone_number
      AND resource.local_claim_active IS TRUE
      AND resource.ownership_state = 'unverified_hold'
      AND resource.provider_id IS NOT DISTINCT FROM v_resource.provider_id;

    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN
      RAISE EXCEPTION 'telnyx_phone_number_repair_registry_cas_lost'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    INSERT INTO public.telnyx_managed_resources (
      business_id,
      phone_number_id,
      resource_type,
      provider_id,
      canonical_e164,
      ownership_state
    ) VALUES (
      p_business_id,
      p_phone_number_id,
      'phone_number',
      p_resolved_resource_id,
      p_phone_number,
      'unverified_hold'
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_telnyx_phone_managed_resource_id()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.repair_telnyx_phone_number_resource_id(
  uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.repair_telnyx_phone_number_resource_id(
  uuid, uuid, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.repair_telnyx_phone_number_resource_id(
  uuid, uuid, text, text, text
) IS
  'Service-role-only atomic CAS from a legacy Telnyx order UUID to the exact decimal owned phone-number resource ID, preserving order provenance and an unverified release hold.';

-- ---------------------------------------------------------------------------
-- Paid number-order create-intent fence
-- ---------------------------------------------------------------------------

ALTER TABLE public.telnyx_registration_events
  DROP CONSTRAINT telnyx_registration_events_telnyx_resource_type_check;

ALTER TABLE public.telnyx_registration_events
  ADD CONSTRAINT telnyx_registration_events_telnyx_resource_type_check
  CHECK (
    telnyx_resource_type IN (
      'brand',
      'campaign',
      'messaging_profile',
      'voice_application',
      'phone_number',
      'phone_number_assignment'
    )
  );

CREATE UNIQUE INDEX
  telnyx_registration_events_active_number_order_intent_unique
ON public.telnyx_registration_events (business_id, event_type)
WHERE status = 'started'
  AND event_type = 'phone_number_order_create_intent';

COMMENT ON INDEX
  public.telnyx_registration_events_active_number_order_intent_unique IS
  'Allows only one unresolved paid Telnyx phone-number order create intent per business.';

COMMIT;
