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

interface CreateRoomRequestBody {
    password?: string
    maxUsers?: number
}

interface LeaveRoomRequestBody {
    roomId: string
}

interface JoinRoomRequestBody {
    roomId: string
    password?: string
}

interface DeleteRoomRequestBody {
    roomId: string
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

    app.post('/api/rooms', async (req: Request<{}, {}, CreateRoomRequestBody>, res: Response) => {
        try {
            const { token } = req.headers
            const { password, maxUsers } = req.body

            if (!token) {
                return res.status(401).json({ error: '请先登录' })
            }

            const payload = verifyToken(token as string)
            if (!payload) {
                return res.status(401).json({ error: 'Token无效或已过期' })
            }

            const roomId = Math.random().toString(36).substring(2, 8).toUpperCase()

            const room = await prisma.room.create({
                data: {
                    roomId,
                    password: password || null,
                    ownerId: payload.userId,
                    maxUsers: maxUsers || 10,
                    status: 'active'
                }
            })

            await prisma.roomMember.create({
                data: {
                    roomId: room.id,
                    userId: payload.userId,
                    role: 'owner'
                }
            })

            res.status(201).json({
                success: true,
                message: '房间创建成功',
                room: {
                    id: room.id,
                    roomId: room.roomId,
                    name: room.name,
                    maxUsers: room.maxUsers,
                    status: room.status,
                    createdAt: room.createdAt
                }
            })
        } catch (error) {
            console.error('创建房间错误:', error)
            res.status(500).json({ error: '创建房间失败，请稍后重试' })
        }
    })

    app.post('/api/rooms/leave', async (req: Request<{}, {}, LeaveRoomRequestBody>, res: Response) => {
        try {
            const { token } = req.headers
            const { roomId } = req.body

            if (!token) {
                return res.status(401).json({ error: '请先登录' })
            }

            const payload = verifyToken(token as string)
            if (!payload) {
                return res.status(401).json({ error: 'Token无效或已过期' })
            }

            if (!roomId) {
                return res.status(400).json({ error: '房间ID不能为空' })
            }

            const room = await prisma.room.findUnique({
                where: { roomId }
            })

            if (!room) {
                return res.status(404).json({ error: '房间不存在' })
            }

            if (room.ownerId === payload.userId) {
                await prisma.room.delete({
                    where: { id: room.id }
                })
                res.json({
                    success: true,
                    message: '房间已解散'
                })
            } else {
                await prisma.roomMember.deleteMany({
                    where: {
                        roomId: room.id,
                        userId: payload.userId
                    }
                })
                res.json({
                    success: true,
                    message: '已退出房间'
                })
            }
        } catch (error) {
            console.error('退出房间错误:', error)
            res.status(500).json({ error: '退出房间失败，请稍后重试' })
        }
    })

    app.post('/api/rooms/join', async (req: Request<{}, {}, JoinRoomRequestBody>, res: Response) => {
        try {
            const { token } = req.headers
            const { roomId, password } = req.body

            if (!token) {
                return res.status(401).json({ error: '请先登录' })
            }

            const payload = verifyToken(token as string)
            if (!payload) {
                return res.status(401).json({ error: 'Token无效或已过期' })
            }

            if (!roomId) {
                return res.status(400).json({ error: '房间ID不能为空' })
            }

            const room = await prisma.room.findUnique({
                where: { roomId }
            })

            if (!room) {
                return res.status(404).json({ error: '房间不存在' })
            }

            if (room.password && room.password !== password) {
                return res.status(401).json({ error: '房间密码错误' })
            }

            const existingMember = await prisma.roomMember.findUnique({
                where: {
                    roomId_userId: {
                        roomId: room.id,
                        userId: payload.userId
                    }
                }
            })

            if (existingMember) {
                return res.status(400).json({ error: '您已经在该房间中' })
            }

            const memberCount = await prisma.roomMember.count({
                where: { roomId: room.id }
            })

            if (memberCount >= room.maxUsers) {
                return res.status(400).json({ error: '房间人数已满' })
            }

            await prisma.roomMember.create({
                data: {
                    roomId: room.id,
                    userId: payload.userId,
                    role: 'member'
                }
            })

            res.json({
                success: true,
                message: '加入房间成功',
                room: {
                    id: room.id,
                    roomId: room.roomId,
                    name: room.name,
                    maxUsers: room.maxUsers,
                    status: room.status
                }
            })
        } catch (error) {
            console.error('加入房间错误:', error)
            res.status(500).json({ error: '加入房间失败，请稍后重试' })
        }
    })

    app.post('/api/rooms/delete', async (req: Request<{}, {}, DeleteRoomRequestBody>, res: Response) => {
        try {
            const { token } = req.headers
            const { roomId } = req.body

            if (!token) {
                return res.status(401).json({ error: '请先登录' })
            }

            const payload = verifyToken(token as string)
            if (!payload) {
                return res.status(401).json({ error: 'Token无效或已过期' })
            }

            if (!roomId) {
                return res.status(400).json({ error: '房间ID不能为空' })
            }

            const room = await prisma.room.findUnique({
                where: { roomId }
            })

            if (!room) {
                return res.status(404).json({ error: '房间不存在' })
            }

            if (room.ownerId !== payload.userId) {
                return res.status(403).json({ error: '只有房主才能解散房间' })
            }

            await prisma.room.delete({
                where: { id: room.id }
            })

            res.json({
                success: true,
                message: '房间已解散'
            })
        } catch (error) {
            console.error('删除房间错误:', error)
            res.status(500).json({ error: '删除房间失败，请稍后重试' })
        }
    })
}
