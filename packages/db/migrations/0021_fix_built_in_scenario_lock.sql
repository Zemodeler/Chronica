-- The original lock function is shared by tables with different columns.
-- Convert OLD to JSON for the scenario-version-only field so PostgreSQL does
-- not try to resolve scenario_id on the scenarios or map-assets tables.
CREATE OR REPLACE FUNCTION "public"."prevent_unapproved_built_in_scenario_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF (
		(TG_TABLE_NAME = 'scenarios' AND OLD.id = '00000000-0000-4000-8000-000000000101')
		OR (TG_TABLE_NAME = 'scenario_versions' AND (to_jsonb(OLD) ->> 'scenario_id') = '00000000-0000-4000-8000-000000000101')
		OR (TG_TABLE_NAME = 'scenario_map_assets' AND OLD.id = '00000000-0000-4000-8000-000000000201')
	) AND COALESCE(current_setting('chronica.scenario_mutation_approved', true), '') <> 'yes' THEN
		RAISE EXCEPTION 'The built-in scenario is locked. Set chronica.scenario_mutation_approved to yes only after explicit owner approval.'
			USING ERRCODE = '42501';
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
