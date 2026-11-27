Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (
  -not (Test-Path -LiteralPath ".\package.json") -or
  -not (Test-Path -LiteralPath ".\prisma\migrations")
) {
  throw "Ejecute el procedimiento desde la raíz del repositorio."
}

function Read-SecretText {
  param([string]$Prompt)

  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

$databaseUrl = $null
$bootstrapPassword = $null
$secretJson = $null
$contextJson = $null
$secretBase64 = $null
$contextBase64 = $null
$bootstrapCode = $null

try {
  $databaseUrl = Read-SecretText "DATABASE_URL exacta de Neon UAT"
  $bootstrapPassword = Read-SecretText "Contraseña inicial del SUPERUSER"
  $bootstrapName = (Read-Host "Nombre del SUPERUSER").Trim()
  $bootstrapEmail = (Read-Host "Email del SUPERUSER").Trim().ToLowerInvariant()
  $expectedNeonHost = (Read-Host "Host exacto de Neon UAT").Trim().ToLowerInvariant()
  $confirmation = Read-Host "Escriba exactamente NEON_UAT_CONFIRMED"

  $secretPayload = [pscustomobject]@{
    databaseUrl      = $databaseUrl
    password         = $bootstrapPassword
  }

  $contextPayload = [pscustomobject]@{
    name             = $bootstrapName
    email            = $bootstrapEmail
    expectedHost     = $expectedNeonHost
    expectedDatabase = "neondb"
    confirmation     = $confirmation
  }

  $secretJson = $secretPayload | ConvertTo-Json -Compress
  $contextJson = $contextPayload | ConvertTo-Json -Compress
  $secretBase64 = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes($secretJson)
  )
  $contextBase64 = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes($contextJson)
  )

  $env:EVIDENTIA_BOOTSTRAP_SECRET = $secretBase64
  $env:EVIDENTIA_BOOTSTRAP_CONTEXT = $contextBase64

  $bootstrapCode = @'
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const EXPECTED_MIGRATIONS = 49;
const LOCK_KEY = "evidentia:first-superuser-bootstrap";

const decodeEnvironmentJson = (name) => {
  const encoded = process.env[name] ?? "";

  if (!encoded) {
    throw new Error("bootstrap payload missing");
  }

  return JSON.parse(
    Buffer.from(encoded, "base64").toString("utf8")
  );
};

const readPayload = () => {
  const secret = decodeEnvironmentJson("EVIDENTIA_BOOTSTRAP_SECRET");
  const context = decodeEnvironmentJson("EVIDENTIA_BOOTSTRAP_CONTEXT");

  delete process.env.EVIDENTIA_BOOTSTRAP_SECRET;
  delete process.env.EVIDENTIA_BOOTSTRAP_CONTEXT;

  return { ...context, ...secret };
};

const rollback = async (client) => {
  try {
    await client.query("ROLLBACK");
    return true;
  } catch {
    return false;
  }
};

const normalizeDatabaseUrl = (value) => {
  const trimmed = value.trim();

  if ([...trimmed].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    return null;
  }

  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }

  return trimmed;
};

/*
 * Todas estas comprobaciones ocurren antes de crear Pool.
 * No realizan consultas ni conexiones.
 */
const validateLocal = async (payload) => {
  const databaseUrl = normalizeDatabaseUrl(String(payload.databaseUrl ?? ""));
  const password = String(payload.password ?? "");
  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const expectedHost = String(payload.expectedHost ?? "").trim().toLowerCase();
  const confirmation = String(payload.confirmation ?? "");
  const expectedDatabase = String(payload.expectedDatabase ?? "");

  if (
    databaseUrl === null ||
    confirmation !== "NEON_UAT_CONFIRMED" ||
    !databaseUrl ||
    !password ||
    !name ||
    !email ||
    !expectedHost ||
    expectedDatabase !== "neondb"
  ) {
    return { ok: false, code: 30, status: "PRECHECK_FAILED_NO_WRITE" };
  }

  if (password.length < 16 || password.length > 128) {
    return { ok: false, code: 31, status: "PRECHECK_FAILED_PASSWORD_POLICY" };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, code: 32, status: "PRECHECK_FAILED_EMAIL" };
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    return { ok: false, code: 33, status: "PRECHECK_FAILED_DATABASE_URL" };
  }

  const host = parsedUrl.hostname.toLowerCase();
  const sslModes = parsedUrl.searchParams.getAll("sslmode");
  const databaseFromUrl = decodeURIComponent(
    parsedUrl.pathname.replace(/^\/+/, "")
  );

  if (
    parsedUrl.protocol !== "postgresql:" &&
    parsedUrl.protocol !== "postgres:" ||
    !parsedUrl.username ||
    !parsedUrl.password ||
    host !== expectedHost ||
    !host.endsWith(".neon.tech") ||
    host.includes("-pooler") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    sslModes.length !== 1 ||
    sslModes[0] !== "require" ||
    databaseFromUrl !== "neondb"
  ) {
    return {
      ok: false,
      code: 34,
      status: "PRECHECK_FAILED_DATABASE_DESTINATION"
    };
  }

  const migrationsPath = path.resolve(
    process.cwd(),
    "prisma",
    "migrations"
  );

  let localMigrations;

  try {
    const entries = await readdir(migrationsPath, {
      withFileTypes: true
    });

    localMigrations = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return {
      ok: false,
      code: 35,
      status: "PRECHECK_FAILED_MIGRATION_DIRECTORY"
    };
  }

  if (localMigrations.length !== EXPECTED_MIGRATIONS) {
    return {
      ok: false,
      code: 36,
      status: "PRECHECK_FAILED_LOCAL_MIGRATION_COUNT"
    };
  }

  /*
   * sslmode=require ya fue validado en la URL original.
   * Se elimina únicamente de la copia entregada a pg para impedir que
   * su parser sustituya la validación explícita del certificado.
   */
  const pgUrl = new URL(parsedUrl.toString());
  pgUrl.searchParams.delete("sslmode");

  return {
    ok: true,
    databaseUrl: pgUrl.toString(),
    password,
    name,
    email,
    localMigrations
  };
};

const executeDatabaseChecksAndBootstrap = async (
  client,
  local
) => {
  let transactionOpen = false;
  let commitAttempted = false;
  let commitConfirmed = false;

  try {
    const databaseInfo = await client.query(`
      SELECT current_database() AS database_name,
             current_schema() AS schema_name
    `);

    if (
      databaseInfo.rows[0]?.database_name !== "neondb" ||
      databaseInfo.rows[0]?.schema_name !== "public"
    ) {
      return {
        code: 37,
        status: "PRECHECK_FAILED_DATABASE_IDENTITY"
      };
    }

    const columnsResult = await client.query(`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'User'
    `);

    const columns = new Map(
      columnsResult.rows.map((row) => [row.column_name, row])
    );

    const noDefault = (column) =>
      !columns.get(column)?.column_default;

    const defaultText = (column) =>
      String(columns.get(column)?.column_default ?? "").toLowerCase();

    if (
      columns.get("id")?.is_nullable !== "NO" ||
      !noDefault("id") ||
      columns.get("email")?.is_nullable !== "NO" ||
      columns.get("name")?.is_nullable !== "NO" ||
      columns.get("passwordHash")?.is_nullable !== "NO" ||
      columns.get("role")?.is_nullable !== "NO" ||
      !noDefault("role") ||
      columns.get("isActive")?.is_nullable !== "NO" ||
      !defaultText("isActive").includes("true") ||
      columns.get("companyId")?.is_nullable !== "YES" ||
      !defaultText("createdAt").includes("current_timestamp") ||
      columns.get("updatedAt")?.is_nullable !== "NO" ||
      !noDefault("updatedAt")
    ) {
      return {
        code: 38,
        status: "PRECHECK_FAILED_USER_SCHEMA"
      };
    }

    const rolesResult = await client.query(`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public'
        AND t.typname = 'Role'
      ORDER BY e.enumsortorder
    `);

    const roles = rolesResult.rows
      .map((row) => row.enumlabel)
      .join(",");

    if (roles !== "SUPERUSER,COMPANY_ADMIN,COMPANY_USER") {
      return {
        code: 39,
        status: "PRECHECK_FAILED_ROLE_ENUM"
      };
    }

    const migrationResult = await client.query(`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `);

    const appliedMigrations = migrationResult.rows
      .filter((row) => row.finished_at && row.rolled_back_at === null)
      .map((row) => row.migration_name)
      .sort();

    const invalidMigration = migrationResult.rows.some(
      (row) => !row.finished_at || row.rolled_back_at !== null
    );

    const sameMigrationSet =
      appliedMigrations.length === local.localMigrations.length &&
      appliedMigrations.every(
        (name, index) => name === local.localMigrations[index]
      );

    if (
      invalidMigration ||
      appliedMigrations.length !== 49 ||
      !sameMigrationSet
    ) {
      return {
        code: 40,
        status: "PRECHECK_FAILED_MIGRATIONS"
      };
    }

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [LOCK_KEY]
    );

    const baseline = await client.query(`
      SELECT
        count(*)::int AS users,
        count(*) FILTER (
          WHERE "role" = 'SUPERUSER'
        )::int AS superusers,
        (SELECT count(*)::int FROM "Company") AS companies,
        (SELECT count(*)::int FROM "Process") AS processes,
        (SELECT count(*)::int FROM "Ticket") AS tickets
      FROM "User"
    `);

    if (baseline.rows[0].superusers > 0) {
      const confirmed = await rollback(client);
      transactionOpen = false;

      return confirmed
        ? { code: 2, status: "ROLLBACK_CONFIRMED_SUPERUSER_EXISTS" }
        : { code: 11, status: "ROLLBACK_RESULT_UNKNOWN_NO_RETRY" };
    }

    const existingEmail = await client.query(
      `SELECT "id"
       FROM "User"
       WHERE lower("email") = lower($1)`,
      [local.email]
    );

    if (existingEmail.rows.length > 0) {
      const confirmed = await rollback(client);
      transactionOpen = false;

      return confirmed
        ? { code: 3, status: "ROLLBACK_CONFIRMED_EMAIL_EXISTS" }
        : { code: 11, status: "ROLLBACK_RESULT_UNKNOWN_NO_RETRY" };
    }

    const passwordHash = await bcrypt.hash(local.password, 12);
    const userId = randomUUID();

    const inserted = await client.query(
      `INSERT INTO "User"
       ("id", "email", "name", "passwordHash", "role",
        "companyId", "isActive", "createdAt", "updatedAt")
       VALUES
       ($1, $2, $3, $4, 'SUPERUSER'::"Role",
        NULL, true, now(), now())
       RETURNING
         "id", "email", "name", "role",
         "companyId", "isActive", "passwordHash"`,
      [userId, local.email, local.name, passwordHash]
    );

    const created = inserted.rows[0];

    if (
      !created ||
      created.email !== local.email ||
      created.role !== "SUPERUSER" ||
      created.companyId !== null ||
      created.isActive !== true ||
      !/^\$2[abxy]\$12\$/.test(created.passwordHash) ||
      !(await bcrypt.compare(local.password, created.passwordHash))
    ) {
      const confirmed = await rollback(client);
      transactionOpen = false;

      return confirmed
        ? {
            code: 12,
            status: "ROLLBACK_CONFIRMED_INSERT_VERIFICATION_FAILED"
          }
        : { code: 11, status: "ROLLBACK_RESULT_UNKNOWN_NO_RETRY" };
    }

    const afterInsert = await client.query(`
      SELECT
        count(*)::int AS users,
        (SELECT count(*)::int FROM "Company") AS companies,
        (SELECT count(*)::int FROM "Process") AS processes,
        (SELECT count(*)::int FROM "Ticket") AS tickets
      FROM "User"
    `);

    if (
      afterInsert.rows[0].users !== baseline.rows[0].users + 1 ||
      afterInsert.rows[0].companies !== baseline.rows[0].companies ||
      afterInsert.rows[0].processes !== baseline.rows[0].processes ||
      afterInsert.rows[0].tickets !== baseline.rows[0].tickets
    ) {
      const confirmed = await rollback(client);
      transactionOpen = false;

      return confirmed
        ? { code: 13, status: "ROLLBACK_CONFIRMED_UNEXPECTED_MUTATION" }
        : { code: 11, status: "ROLLBACK_RESULT_UNKNOWN_NO_RETRY" };
    }

    commitAttempted = true;

    try {
      await client.query("COMMIT");
      commitConfirmed = true;
      transactionOpen = false;
    } catch {
      return {
        code: 20,
        status: "COMMIT_RESULT_UNKNOWN_NO_RETRY"
      };
    }

    const verified = await client.query(
      `SELECT
         "id",
         "email",
         "name",
         "role",
         "companyId",
         "isActive",
         ("passwordHash" ~ '^\$2[abxy]\$12\$')
           AS bcrypt_cost_12
       FROM "User"
       WHERE "id" = $1`,
      [userId]
    );

    const row = verified.rows[0];

    if (
      !row ||
      row.email !== local.email ||
      row.role !== "SUPERUSER" ||
      row.companyId !== null ||
      row.isActive !== true ||
      row.bcrypt_cost_12 !== true
    ) {
      return {
        code: 21,
        status: "COMMIT_CONFIRMED_POST_VERIFY_FAILED_NO_RETRY"
      };
    }

    return {
      code: 0,
      status: "COMMIT_CONFIRMED_VERIFIED",
      id: row.id,
      email: row.email
    };
  } catch {
    if (commitConfirmed) {
      return {
        code: 22,
        status: "COMMIT_CONFIRMED_POST_VERIFY_UNAVAILABLE_NO_RETRY"
      };
    }

    if (commitAttempted && !commitConfirmed) {
      return {
        code: 20,
        status: "COMMIT_RESULT_UNKNOWN_NO_RETRY"
      };
    }

    if (transactionOpen) {
      const confirmed = await rollback(client);
      transactionOpen = false;

      return confirmed
        ? { code: 10, status: "ROLLBACK_CONFIRMED_FAILURE" }
        : { code: 11, status: "ROLLBACK_RESULT_UNKNOWN_NO_RETRY" };
    }

    return {
      code: 30,
      status: "PRECHECK_FAILED_NO_WRITE"
    };
  }
};

const main = async () => {
  const payload = readPayload();

  /*
   * Este bloque ocurre completamente antes de crear Pool.
   */
  const local = await validateLocal(payload);

  if (!local.ok) {
    console.error(`[bootstrap] ${local.status}`);
    return local.code;
  }

  const pool = new Pool({
    connectionString: local.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: true
    }
  });

  let client;
  let result = {
    code: 30,
    status: "PRECHECK_FAILED_NO_WRITE"
  };
  let cleanupFailed = false;

  try {
    client = await pool.connect();
    result = await executeDatabaseChecksAndBootstrap(client, local);
  } catch {
    result = {
      code: 41,
      status: "CONNECTION_FAILED_NO_TRANSACTION"
    };
  } finally {
    try {
      client?.release();
    } catch {
      cleanupFailed = true;
    }

    try {
      await pool.end();
    } catch {
      cleanupFailed = true;
    }
  }

  if (cleanupFailed) {
    console.error(`[bootstrap] ${result.status}_CLEANUP_WARNING`);
  }

  if (result.code === 0) {
    console.log(`[bootstrap] ${result.status}`);
    console.log(`[bootstrap] id=${result.id} email=${result.email}`);
  } else {
    console.error(`[bootstrap] ${result.status}`);
  }

  return result.code;
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    console.error("[bootstrap] PRECHECK_FAILED_NO_WRITE");
    process.exitCode = 30;
  });
'@

  $bootstrapCode |
    node --input-type=module -

  if ($LASTEXITCODE -ne 0) {
    throw "Bootstrap no completado. No repetir automáticamente."
  }
}
finally {
  $databaseUrl = $null
  $bootstrapPassword = $null
  $secretJson = $null
  $contextJson = $null
  $secretBase64 = $null
  $contextBase64 = $null
  $bootstrapCode = $null

  Remove-Item Env:EVIDENTIA_BOOTSTRAP_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:EVIDENTIA_BOOTSTRAP_CONTEXT -ErrorAction SilentlyContinue

  Remove-Variable `
    databaseUrl,
    bootstrapPassword,
    secretJson,
    contextJson,
    secretBase64,
    contextBase64,
    bootstrapCode `
    -ErrorAction SilentlyContinue
}
