import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import prisma from './lib/prisma'
import { setupRoutes } from './server'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(bodyParser.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' })
})

setupRoutes(app)

const server = app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`)
})

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason)
})

export { app, prisma }