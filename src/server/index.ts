import prisma from '../lib/prisma'
import { Request, Response, Express } from 'express'
import { generateToken, verifyToken } from '../utils/jwt'
import { clients } from '../index'
import multer from 'multer'
import path from 'path'
import nodemailer from 'nodemailer'
import crypto from 'crypto'

// Multer configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, uniqueSuffix + path.extname(file.originalname))
    }
})
const upload = multer({ storage: storage })

// Email configuration
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: true,
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_SMTP
    }
});

interface RegisterRequestBody {
    name: string
    phone?: string
    email: string
    password: string
}

interface CheckPhoneRequestBody {
    phone: string
}

interface LoginRequestBody {
    email: string
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
    app.post('/api/upload', upload.single('image'), (req: any, res: Response) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' })
            }
            const protocol = req.protocol
            const host = req.get('host')
            const url = `${protocol}://${host}/uploads/${req.file.filename}`
            res.json({ url })
        } catch (error) {
            console.error('Upload error:', error)
            res.status(500).json({ error: 'Upload failed' })
        }
    })

    app.post('/api/register', async (req: Request<{}, {}, RegisterRequestBody>, res: Response) => {
        try {
            const { name, phone, email, password } = req.body

            if (!name ) {
                return res.status(400).json({ error: '用户名不能为空' })
            }
            if (!email ) {
                return res.status(400).json({ error: '邮箱不能为空' })
            }
            if (!password) {
                return res.status(400).json({ error: '密码不能为空' })
            }

            const existingUser = await prisma.user.findUnique({
                where: { email }
            })

            if (existingUser) {
                return res.status(400).json({ error: '该邮箱已被注册' })
            }

            const verificationToken = crypto.randomBytes(32).toString('hex')

            const user = await prisma.user.create({
                data: {
                    name,
                    phone: phone || null,
                    email,
                    password,
                    isVerified: false,
                    verificationToken
                }
            })

            const backendUrl = `${req.protocol}://${req.get('host')}/api/verify-email-link?token=${verificationToken}`

            const mailOptions = {
                from: process.env.EMAIL,
                to: email,
                subject: 'Infinitec 邮箱验证',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2 style="color: #333;"> Infinitec</h2>
                        <p>请点击下面的按钮验证您的邮箱地址：</p>
                        <a href="${backendUrl}" style="display: inline-block; padding: 10px 20px; background-color: #1890ff; color: white; text-decoration: none; border-radius: 4px;">验证邮箱</a>
                        <p style="margin-top: 20px; font-size: 12px; color: #666;">如果按钮无法点击，请复制以下链接到浏览器打开：</p>
                        <p style="font-size: 12px; color: #666;">${backendUrl}</p>
                    </div>
                `
            }

            try {
                await transporter.sendMail(mailOptions)
                console.log(`Verification email sent to ${email}`)
            } catch (emailError) {
                console.error('Email send error:', emailError)
                await prisma.user.delete({ where: { id: user.id } })
                return res.status(500).json({ error: '发送验证邮件失败，请检查邮箱地址是否正确' })
            }

            res.status(201).json({
                success: true,
                message: '注册成功，请前往邮箱验证',
            })
        } catch (error) {
            console.error('注册错误:', error)
            res.status(500).json({ error: '注册失败，请稍后重试' })
        }
    })

    app.get('/api/verify-email-link', async (req: Request, res: Response) => {
        try {
            const { token } = req.query
            
            if (!token || typeof token !== 'string') {
                return res.status(400).send('无效的验证链接')
            }

            const user = await prisma.user.findUnique({
                where: { verificationToken: token }
            })

            if (!user) {
                return res.status(400).send('验证链接无效或已过期')
            }

            await prisma.user.update({
                where: { id: user.id },
                data: {
                    isVerified: true,
                    verificationToken: null
                }
            })

            res.redirect('http://localhost:5173/?verified=true')
        } catch (error) {
            console.error('验证错误:', error)
            res.status(500).send('验证失败')
        }
    })

    app.post('/api/login', async (req: Request<{}, {}, LoginRequestBody>, res: Response) => {
        try {
            const { email, password } = req.body
            if (!email || !password) {
                return res.status(400).json({ error: '请填写邮箱和密码' })
            }

            const user = await prisma.user.findUnique({
                where: { email }
            })

            if (!user) {
                return res.status(401).json({ error: '邮箱或密码错误' })
            }

            if (user.password !== password) {
                return res.status(401).json({ error: '邮箱或密码错误' })
            }

            if (!user.isVerified) {
                return res.status(401).json({ error: '请先前往邮箱完成验证' })
            }

            const token = generateToken({
                userId: user.id,
                name: user.name,
                phone: user.phone || undefined,
                email: user.email || undefined
            })

            res.json({
                success: true,
                message: '登录成功',
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    phone: user.phone,
                    email: user.email
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

    interface UpdateUserRequestBody {
        name: string
        phone?: string
    }

    app.post('/api/user/update', async (req: Request<{}, {}, UpdateUserRequestBody>, res: Response) => {
        try {
            const authHeader = req.headers.authorization
            if (!authHeader) {
                return res.status(401).json({ error: '请先登录' })
            }
            
            const token = authHeader.split(' ')[1]
            const payload = verifyToken(token)
            
            if (!payload) {
                return res.status(401).json({ error: 'Token无效或已过期' })
            }

            const { name, phone } = req.body

            if (!name) {
                return res.status(400).json({ error: '用户名不能为空' })
            }

            // Check if phone is already taken by another user
            if (phone) {
                const existingUser = await prisma.user.findFirst({
                    where: {
                        phone,
                        id: { not: payload.userId }
                    }
                })
                
                if (existingUser) {
                    return res.status(400).json({ error: '手机号已被其他用户使用' })
                }
            }

            const updatedUser = await prisma.user.update({
                where: { id: payload.userId },
                data: { 
                    name, 
                    phone: phone || null 
                }
            })

            const newToken = generateToken({
                userId: updatedUser.id,
                name: updatedUser.name,
                phone: updatedUser.phone || undefined,
                email: updatedUser.email || undefined
            })

            res.json({
                success: true,
                message: '更新成功',
                token: newToken,
                user: {
                    id: updatedUser.id,
                    name: updatedUser.name,
                    phone: updatedUser.phone,
                    email: updatedUser.email
                }
            })
        } catch (error) {
            console.error('更新用户信息错误:', error)
            res.status(500).json({ error: '更新失败，请稍后重试' })
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
                    phone: payload.phone,
                    email: payload.email
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
                const members = await prisma.roomMember.findMany({
                    where: {
                        roomId: room.id
                    }
                })
                
                for (const member of members) {
                    const clientId = `${room.roomId}_${member.userId}`
                    const client = clients.get(clientId)
                    
                    if (client) {
                        try {
                            client.ws.send(JSON.stringify({
                                type: 'room_deleted',
                                roomId: room.roomId
                            }))
                            console.log(`通知用户 ${member.userId} 房间 ${room.roomId} 已解散`)
                        } catch (error) {
                            console.error(`通知用户 ${member.userId} 失败:`, error)
                        }
                    }
                }
                
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

            const members = await prisma.roomMember.findMany({
                where: {
                    roomId: room.id
                }
            })
            
            for (const member of members) {
                const clientId = `${room.roomId}_${member.userId}`
                const client = clients.get(clientId)
                
                if (client) {
                    try {
                        client.ws.send(JSON.stringify({
                            type: 'room_deleted',
                            roomId: room.roomId
                        }))
                        console.log(`通知用户 ${member.userId} 房间 ${room.roomId} 已解散`)
                    } catch (error) {
                        console.error(`通知用户 ${member.userId} 失败:`, error)
                    }
                }
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
