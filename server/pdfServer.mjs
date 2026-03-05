import express from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'

const app = express()
const port = Number(process.env.PORT ?? 3001)
const maxCards = Number(process.env.PDF_MAX_CARDS ?? 250)
const pageWidth = 595.28
const pageHeight = 841.89
const margin = 24
const uploadDir = path.join(os.tmpdir(), 'achievements-pdf-api')

await fs.mkdir(uploadDir, { recursive: true })

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

const drawImageOnA4Page = (pdfDoc, image) => {
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
  res.json({ ok: true })
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
        drawImageOnA4Page(pdfDoc, image)
        continue
      }
      if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
        const image = await pdfDoc.embedJpg(fileBuffer)
        drawImageOnA4Page(pdfDoc, image)
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

  console.error('PDF API error:', error)
  res.status(500).json({ error: 'Failed to generate PDF.' })
})

app.listen(port, () => {
  console.log(`PDF API listening on :${port}`)
})
