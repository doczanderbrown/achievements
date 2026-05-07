import express from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { Pool } from 'pg'

const app = express()
const port = Number(process.env.PORT ?? 3001)
const maxCards = Number(process.env.PDF_MAX_CARDS ?? 250)
const pageWidth = 792
const pageHeight = 612
const margin = 16
const uploadDir = path.join(os.tmpdir(), 'achievements-pdf-api')

const databaseUrl = process.env.DATABASE_URL ?? ''
const dbSslEnabled = process.env.DATABASE_SSL === 'true'
const dbPool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: dbSslEnabled ? { rejectUnauthorized: false } : undefined,
    })
  : null

let dbInitialized = false
let dbInitializationError = null

await fs.mkdir(uploadDir, { recursive: true })

app.use(express.json({ limit: '10mb' }))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const extension = file.mimetype === 'image/png' ? '.png' : '.jpg'
      cb(null, `${suffix}${extension}`)
    },
  }),
  limits: {
    files: maxCards,
    fileSize: 8 * 1024 * 1024,
    fieldSize: 256 * 1024,
    fields: 4,
  },
})

const sanitizePdfFileName = (value) => {
  const cleaned = (value || 'report-cards.pdf')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
  if (!cleaned) return 'report-cards.pdf'
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`
}

const normalizeDateToken = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [year, month, day] = text.split('-').map(Number)
  if (!year || !month || !day) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return text
}

const toFiniteNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

const normalizeSnapshotUsers = (users) => {
  if (!Array.isArray(users)) return []

  return users
    .map((candidate) => {
      const userName = String(candidate?.userName ?? '').trim()
      const techLabel = String(candidate?.techLabel ?? '').trim()
      const sourceUserId = String(candidate?.userId ?? '').trim()
      const fallbackNameKey = userName ? userName.toLowerCase() : techLabel.toLowerCase()
      const userId = sourceUserId || (fallbackNameKey ? `name:${fallbackNameKey}` : '')
      if (!userId) {
        return null
      }

      return {
        userId,
        userName: userName || techLabel || 'Unknown',
        techLabel: techLabel || userName || userId,
        hoursWorked: toFiniteNumber(candidate?.hoursWorked),
        productivity: toFiniteNumber(candidate?.productivity),
        quality: toFiniteNumber(candidate?.quality),
        versatility: toFiniteNumber(candidate?.versatility),
        overall: toFiniteNumber(candidate?.overall),
        productivityPercentile: toFiniteNumber(candidate?.productivityPercentile),
        qualityPercentile: toFiniteNumber(candidate?.qualityPercentile),
        versatilityPercentile: toFiniteNumber(candidate?.versatilityPercentile),
        overallPercentile: toFiniteNumber(candidate?.overallPercentile),
        deconTotal: toFiniteNumber(candidate?.deconTotal),
        assemblyTotal: toFiniteNumber(candidate?.assemblyTotal),
        sterilizeTotal: toFiniteNumber(candidate?.sterilizeTotal),
        whpu: toFiniteNumber(candidate?.whpu),
        defectRate: toFiniteNumber(candidate?.defectRate),
        missingInstRate: toFiniteNumber(candidate?.missingInstRate),
      }
    })
    .filter(Boolean)
}

const initializeDatabase = async () => {
  if (!dbPool) {
    dbInitialized = false
    return
  }

  const client = await dbPool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS spd_workbook_uploads (
        id BIGSERIAL PRIMARY KEY,
        period_start DATE,
        period_end DATE,
        period_label TEXT,
        source_file_name TEXT NOT NULL,
        user_count INTEGER NOT NULL DEFAULT 0,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT spd_workbook_uploads_period_unique UNIQUE (period_start, period_end)
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS spd_user_snapshots (
        id BIGSERIAL PRIMARY KEY,
        workbook_id BIGINT NOT NULL REFERENCES spd_workbook_uploads(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        tech_label TEXT NOT NULL,
        hours_worked DOUBLE PRECISION NOT NULL DEFAULT 0,
        productivity DOUBLE PRECISION NOT NULL DEFAULT 0,
        quality DOUBLE PRECISION NOT NULL DEFAULT 0,
        versatility DOUBLE PRECISION NOT NULL DEFAULT 0,
        overall DOUBLE PRECISION NOT NULL DEFAULT 0,
        productivity_percentile DOUBLE PRECISION NOT NULL DEFAULT 0,
        quality_percentile DOUBLE PRECISION NOT NULL DEFAULT 0,
        versatility_percentile DOUBLE PRECISION NOT NULL DEFAULT 0,
        overall_percentile DOUBLE PRECISION NOT NULL DEFAULT 0,
        decon_total DOUBLE PRECISION NOT NULL DEFAULT 0,
        assembly_total DOUBLE PRECISION NOT NULL DEFAULT 0,
        sterilize_total DOUBLE PRECISION NOT NULL DEFAULT 0,
        whpu DOUBLE PRECISION NOT NULL DEFAULT 0,
        defect_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        missing_inst_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        CONSTRAINT spd_user_snapshots_workbook_user_unique UNIQUE (workbook_id, user_id)
      );
    `)

    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_spd_user_snapshots_user_id ON spd_user_snapshots(user_id);',
    )
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_spd_user_snapshots_lower_user_name ON spd_user_snapshots(LOWER(user_name));',
    )
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_spd_workbook_uploads_uploaded_at ON spd_workbook_uploads(uploaded_at);',
    )

    dbInitialized = true
    dbInitializationError = null
  } catch (error) {
    dbInitialized = false
    dbInitializationError = error
    throw error
  } finally {
    client.release()
  }
}

const ensureDatabaseReady = async () => {
  if (!dbPool) {
    return {
      ok: false,
      reason: 'DATABASE_URL is not configured for SPD history persistence.',
      code: 'DB_NOT_CONFIGURED',
    }
  }

  if (dbInitialized) {
    return { ok: true }
  }

  try {
    await initializeDatabase()
    return { ok: true }
  } catch {
    return {
      ok: false,
      reason: 'SPD history database is unavailable.',
      code: 'DB_UNAVAILABLE',
    }
  }
}

if (dbPool) {
  initializeDatabase()
    .then(() => {
      console.log('SPD history database initialized')
    })
    .catch((error) => {
      console.error('Failed to initialize SPD history database:', error)
    })
}

const drawImageOnPage = (pdfDoc, image) => {
  const page = pdfDoc.addPage([pageWidth, pageHeight])
  const maxWidth = pageWidth - margin * 2
  const maxHeight = pageHeight - margin * 2
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
  const width = image.width * scale
  const height = image.height * scale

  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  })
}

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    ok: true,
    history: {
      configured: Boolean(dbPool),
      ready: dbInitialized,
      lastError: dbInitializationError ? 'database initialization failed' : null,
    },
  })
})

app.get('/api/spd-history/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    ok: true,
    configured: Boolean(dbPool),
    ready: dbInitialized,
    reason: dbInitializationError ? 'database initialization failed' : null,
  })
})

app.post('/api/spd-history/workbook', async (req, res, next) => {
  const status = await ensureDatabaseReady()
  if (!status.ok) {
    res.status(503).json({ error: status.reason, code: status.code })
    return
  }

  const sourceFileName = String(req.body?.sourceFileName ?? '').trim()
  const periodStart = normalizeDateToken(req.body?.periodStart)
  const periodEnd = normalizeDateToken(req.body?.periodEnd)
  const periodLabelRaw = String(req.body?.periodLabel ?? '').trim()
  const periodLabel = periodLabelRaw || null
  const users = normalizeSnapshotUsers(req.body?.users)

  if (!sourceFileName) {
    res.status(400).json({ error: 'sourceFileName is required.' })
    return
  }

  if (users.length === 0) {
    res.status(400).json({ error: 'users array is required.' })
    return
  }

  if (users.length > 5000) {
    res.status(413).json({ error: 'Too many users in a single workbook payload.' })
    return
  }

  const usingPeriodUpsert = Boolean(periodStart && periodEnd)
  const client = await dbPool.connect()

  try {
    await client.query('BEGIN')

    let workbookId = null

    if (usingPeriodUpsert) {
      const upsertResult = await client.query(
        `
          INSERT INTO spd_workbook_uploads (
            period_start,
            period_end,
            period_label,
            source_file_name,
            user_count,
            uploaded_at
          )
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (period_start, period_end)
          DO UPDATE SET
            period_label = EXCLUDED.period_label,
            source_file_name = EXCLUDED.source_file_name,
            user_count = EXCLUDED.user_count,
            uploaded_at = NOW()
          RETURNING id;
        `,
        [periodStart, periodEnd, periodLabel, sourceFileName, users.length],
      )
      workbookId = upsertResult.rows[0]?.id ?? null

      await client.query('DELETE FROM spd_user_snapshots WHERE workbook_id = $1;', [workbookId])
    } else {
      const insertResult = await client.query(
        `
          INSERT INTO spd_workbook_uploads (
            period_start,
            period_end,
            period_label,
            source_file_name,
            user_count,
            uploaded_at
          )
          VALUES (NULL, NULL, $1, $2, $3, NOW())
          RETURNING id;
        `,
        [periodLabel, sourceFileName, users.length],
      )
      workbookId = insertResult.rows[0]?.id ?? null
    }

    if (!workbookId) {
      throw new Error('Failed to persist workbook metadata.')
    }

    for (const user of users) {
      await client.query(
        `
          INSERT INTO spd_user_snapshots (
            workbook_id,
            user_id,
            user_name,
            tech_label,
            hours_worked,
            productivity,
            quality,
            versatility,
            overall,
            productivity_percentile,
            quality_percentile,
            versatility_percentile,
            overall_percentile,
            decon_total,
            assembly_total,
            sterilize_total,
            whpu,
            defect_rate,
            missing_inst_rate
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
          )
          ON CONFLICT (workbook_id, user_id)
          DO UPDATE SET
            user_name = EXCLUDED.user_name,
            tech_label = EXCLUDED.tech_label,
            hours_worked = EXCLUDED.hours_worked,
            productivity = EXCLUDED.productivity,
            quality = EXCLUDED.quality,
            versatility = EXCLUDED.versatility,
            overall = EXCLUDED.overall,
            productivity_percentile = EXCLUDED.productivity_percentile,
            quality_percentile = EXCLUDED.quality_percentile,
            versatility_percentile = EXCLUDED.versatility_percentile,
            overall_percentile = EXCLUDED.overall_percentile,
            decon_total = EXCLUDED.decon_total,
            assembly_total = EXCLUDED.assembly_total,
            sterilize_total = EXCLUDED.sterilize_total,
            whpu = EXCLUDED.whpu,
            defect_rate = EXCLUDED.defect_rate,
            missing_inst_rate = EXCLUDED.missing_inst_rate;
        `,
        [
          workbookId,
          user.userId,
          user.userName,
          user.techLabel,
          user.hoursWorked,
          user.productivity,
          user.quality,
          user.versatility,
          user.overall,
          user.productivityPercentile,
          user.qualityPercentile,
          user.versatilityPercentile,
          user.overallPercentile,
          user.deconTotal,
          user.assemblyTotal,
          user.sterilizeTotal,
          user.whpu,
          user.defectRate,
          user.missingInstRate,
        ],
      )
    }

    await client.query('COMMIT')

    res.json({
      ok: true,
      workbookId,
      userCount: users.length,
      replacedPeriod: usingPeriodUpsert,
      periodStart,
      periodEnd,
      uploadedAt: new Date().toISOString(),
    })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failure and return the original error.
    }
    next(error)
  } finally {
    client.release()
  }
})

app.get('/api/spd-history/user-trend', async (req, res, next) => {
  const status = await ensureDatabaseReady()
  if (!status.ok) {
    res.status(503).json({ error: status.reason, code: status.code })
    return
  }

  const userId = String(req.query?.userId ?? '').trim()
  const userName = String(req.query?.userName ?? '').trim()

  if (!userId && !userName) {
    res.status(400).json({ error: 'userId or userName query parameter is required.' })
    return
  }

  try {
    const trendResult = await dbPool.query(
      `
        SELECT
          w.id AS workbook_id,
          w.period_start,
          w.period_end,
          w.period_label,
          w.source_file_name,
          w.uploaded_at,
          s.user_id,
          s.user_name,
          s.tech_label,
          s.hours_worked,
          s.productivity,
          s.quality,
          s.versatility,
          s.overall,
          s.productivity_percentile,
          s.quality_percentile,
          s.versatility_percentile,
          s.overall_percentile,
          s.decon_total,
          s.assembly_total,
          s.sterilize_total,
          s.whpu,
          s.defect_rate,
          s.missing_inst_rate
        FROM spd_user_snapshots s
        INNER JOIN spd_workbook_uploads w ON w.id = s.workbook_id
        WHERE ($1 <> '' AND s.user_id = $1)
           OR ($1 = '' AND $2 <> '' AND LOWER(s.user_name) = LOWER($2))
        ORDER BY
          COALESCE(w.period_end, w.period_start, DATE(w.uploaded_at)) ASC,
          w.uploaded_at ASC,
          w.id ASC;
      `,
      [userId, userName],
    )

    const points = trendResult.rows.map((row) => ({
      workbookId: Number(row.workbook_id),
      periodStart: row.period_start,
      periodEnd: row.period_end,
      periodLabel: row.period_label,
      sourceFileName: row.source_file_name,
      uploadedAt: row.uploaded_at,
      userId: row.user_id,
      userName: row.user_name,
      techLabel: row.tech_label,
      hoursWorked: toFiniteNumber(row.hours_worked),
      productivity: toFiniteNumber(row.productivity),
      quality: toFiniteNumber(row.quality),
      versatility: toFiniteNumber(row.versatility),
      overall: toFiniteNumber(row.overall),
      productivityPercentile: toFiniteNumber(row.productivity_percentile),
      qualityPercentile: toFiniteNumber(row.quality_percentile),
      versatilityPercentile: toFiniteNumber(row.versatility_percentile),
      overallPercentile: toFiniteNumber(row.overall_percentile),
      deconTotal: toFiniteNumber(row.decon_total),
      assemblyTotal: toFiniteNumber(row.assembly_total),
      sterilizeTotal: toFiniteNumber(row.sterilize_total),
      whpu: toFiniteNumber(row.whpu),
      defectRate: toFiniteNumber(row.defect_rate),
      missingInstRate: toFiniteNumber(row.missing_inst_rate),
    }))

    res.setHeader('Cache-Control', 'no-store')
    res.json({
      ok: true,
      points,
      matchedBy: userId ? 'userId' : 'userName',
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/spd-history/periods', async (_req, res, next) => {
  const status = await ensureDatabaseReady()
  if (!status.ok) {
    res.status(503).json({ error: status.reason, code: status.code })
    return
  }

  try {
    const result = await dbPool.query(`
      SELECT
        w.id,
        w.period_start,
        w.period_end,
        w.period_label,
        w.source_file_name,
        w.user_count,
        w.uploaded_at,
        COUNT(s.id)::int AS snapshot_count
      FROM spd_workbook_uploads w
      LEFT JOIN spd_user_snapshots s ON s.workbook_id = w.id
      GROUP BY w.id
      ORDER BY COALESCE(w.period_end, w.period_start, DATE(w.uploaded_at)) DESC, w.uploaded_at DESC;
    `)

    res.setHeader('Cache-Control', 'no-store')
    res.json({
      ok: true,
      periods: result.rows,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/report-cards/pdf', upload.array('cards', maxCards), async (req, res, next) => {
  const uploadedPaths = []
  try {
    const files = Array.isArray(req.files) ? req.files : []
    if (files.length === 0) {
      res.status(400).json({ error: 'No card images were provided.' })
      return
    }

    const pdfDoc = await PDFDocument.create()

    for (const file of files) {
      uploadedPaths.push(file.path)
      const fileBuffer = await fs.readFile(file.path)

      if (file.mimetype === 'image/png') {
        const image = await pdfDoc.embedPng(fileBuffer)
        drawImageOnPage(pdfDoc, image)
        continue
      }
      if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
        const image = await pdfDoc.embedJpg(fileBuffer)
        drawImageOnPage(pdfDoc, image)
      }
    }

    if (pdfDoc.getPageCount() === 0) {
      res.status(400).json({ error: 'No supported image files were provided.' })
      return
    }

    const fileName = sanitizePdfFileName(req.body?.filename)
    const pdfBytes = await pdfDoc.save()

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(Buffer.from(pdfBytes))
  } catch (error) {
    next(error)
  } finally {
    await Promise.all(
      uploadedPaths.map(async (filePath) => {
        try {
          await fs.unlink(filePath)
        } catch {
          // No-op; temp file may already be gone.
        }
      }),
    )
  }
})

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    res.status(status).json({ error: `Upload error: ${error.message}` })
    return
  }

  console.error('API error:', error)
  res.status(500).json({ error: 'Request failed.' })
})

app.listen(port, () => {
  console.log(`PDF API listening on :${port}`)
})
