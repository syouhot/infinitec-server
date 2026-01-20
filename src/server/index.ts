import prisma from '../lib/prisma'
import { Request, Response, Express } from 'express'
import { generateToken, verifyToken } from '../utils/jwt'

interface RegisterRequestBody {
    name: string
    phone: string
    password: string
}

interface CheckPhoneRequestBody {
    phone: string
}

interface LoginRequestBody {
    phone: string
    password: string
}

export function setupRoutes(app: Express) {
    app.post('/api/register', async (req: Request<{}, {}, RegisterRequestBody>, res: Response) => {
        try {
            const { name, phone, password } = req.body

            if (!name || !phone || !password) {
                return res.status(400).json({ error: '请填写所有字段' })
            }

            if (phone.length !== 11) {
                return res.status(400).json({ error: '请输入正确的手机号' })
            }

            const existingUser = await prisma.user.findUnique({
                where: { phone }
            })

            if (existingUser) {
                return res.status(400).json({ error: '该手机号已被注册' })
            }

            const user = await prisma.user.create({
                data: {
                    name,
                    phone,
                    password
                }
            })

            const token = generateToken({
                userId: user.id,
                name: user.name,
                phone: user.phone
            })

            res.status(201).json({
                success: true,
                message: '注册成功',
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    phone: user.phone
                }
            })
        } catch (error) {
            console.error('注册错误:', error)
            res.status(500).json({ error: '注册失败，请稍后重试' })
        }
    })

    app.post('/api/login', async (req: Request<{}, {}, LoginRequestBody>, res: Response) => {
        try {
            const { phone, password } = req.body
            if (!phone || !password) {
                return res.status(400).json({ error: '请填写手机号和密码' })
            }

            if (phone.length !== 11) {
                return res.status(400).json({ error: '请输入正确的手机号' })
            }

            const user = await prisma.user.findUnique({
                where: { phone }
            })

            if (!user) {
                return res.status(401).json({ error: '手机号或密码错误' })
            }

            if (user.password !== password) {
                return res.status(401).json({ error: '手机号或密码错误' })
            }

            const token = generateToken({
                userId: user.id,
                name: user.name,
                phone: user.phone
            })

            res.json({
                success: true,
                message: '登录成功',
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    phone: user.phone
                }
            })
        } catch (error) {
            console.error('登录错误:', error)
            res.status(500).json({ error: '登录失败，请稍后重试' })
        }
    })

    app.post('/api/check-phone', async (req: Request<{}, {}, CheckPhoneRequestBody>, res: Response) => {
        try {
            const { phone } = req.body

            if (!phone) {
                return res.status(400).json({ error: '手机号不能为空' })
            }

            const user = await prisma.user.findUnique({
                where: { phone }
            })

            res.json({ exists: user !== null })
        } catch (error) {
            console.error('检查手机号错误:', error)
            res.status(500).json({ error: '检查失败' })
        }
    })

    app.post('/api/verify-token', (req: Request, res: Response) => {
        try {
            const { token } = req.body

            if (!token) {
                return res.status(400).json({ error: 'Token不能为空' })
            }

            const payload = verifyToken(token)

            if (!payload) {
                return res.status(401).json({ error: 'Token无效或已过期' })
            }

            res.json({
                valid: true,
                user: {
                    id: payload.userId,
                    name: payload.name,
                    phone: payload.phone
                }
            })
        } catch (error) {
            console.error('验证Token错误:', error)
            res.status(500).json({ error: '验证失败' })
        }
    })
}
