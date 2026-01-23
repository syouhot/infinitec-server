import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import { WebSocketServer } from 'ws'
import prisma from './lib/prisma'
import { setupRoutes } from './server'
import { HEARTBEAT_INTERVAL, MAX_FAILED_HEARTBEATS } from './constants'

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

const wss = new WebSocketServer({ server })

interface ClientConnection {
  ws: any
  userId: string
  roomId: string
  failedHeartbeats: number
  lastHeartbeat: number
}

const clients = new Map<string, ClientConnection>()

export { clients }

wss.on('connection', (ws: any, req: any) => {
  console.log('新的WebSocket连接')
  
  let userId: string | null = null
  let roomId: string | null = null

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message)
      
      if (data.type === 'join') {
        userId = data.userId
        roomId = data.roomId
        
        if (userId && roomId) {
          const clientId = `${roomId}_${userId}`
          clients.set(clientId, {
            ws,
            userId,
            roomId,
            failedHeartbeats: 0,
            lastHeartbeat: Date.now()
          })
          
          console.log(`用户 ${userId} 加入房间 ${roomId}`)
          
          ws.send(JSON.stringify({
            type: 'joined',
            roomId,
            userId
          }))
        }
      } else if (data.type === 'heartbeat') {
        if (userId && roomId) {
          const clientId = `${roomId}_${userId}`
          const client = clients.get(clientId)
          
          if (client) {
            client.failedHeartbeats = 0
            client.lastHeartbeat = Date.now()
            clients.set(clientId, client)
            
            console.log(`收到用户 ${userId} (房间: ${roomId}) 的心跳响应`)
            
            ws.send(JSON.stringify({
              type: 'heartbeat_ack',
              timestamp: Date.now()
            }))
          }
        }
      } else if (data.type === 'draw_event') {
        // 广播绘画事件给房间内其他用户
        if (roomId) {
          clients.forEach((client) => {
            if (client.roomId === roomId && client.userId !== userId) {
              client.ws.send(JSON.stringify(data))
            }
          })
        }
      }
    } catch (error) {
      console.error('处理WebSocket消息错误:', error)
    }
  })

  ws.on('close', async () => {
    if (userId && roomId) {
      const clientId = `${roomId}_${userId}`
      clients.delete(clientId)
      console.log(`用户 ${userId} (房间: ${roomId}) 断开连接`)
    }
  })

  ws.on('error', (error) => {
    console.error('WebSocket错误:', error)
  })
})

const heartbeatCheckInterval = setInterval(async () => {
  console.log('开始心跳检测...')
  
  try {
    const rooms = await prisma.room.findMany({
      where: {
        status: 'active'
      }
    })
    
    console.log(`发现 ${rooms.length} 个活跃房间`)
    
    for (const room of rooms) {
      const members = await prisma.roomMember.findMany({
        where: {
          roomId: room.id
        },
        include: {
          user: true
        }
      })
      
      console.log(`房间 ${room.roomId} 有 ${members.length} 个成员`)
      
      const roomExists = await prisma.room.findUnique({
        where: {
          id: room.id
        }
      })
      
      if (!roomExists) {
        console.log(`房间 ${room.roomId} 已不存在，通知所有成员`)
        
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
              clients.delete(clientId)
            } catch (error) {
              console.error(`通知用户 ${member.userId} 失败:`, error)
              clients.delete(clientId)
            }
          }
        }
        
        continue
      }
      
      for (const member of members) {
        const clientId = `${room.roomId}_${member.userId}`
        const client = clients.get(clientId)
        
        if (client) {
          const heartbeatMessage = JSON.stringify({
            type: 'heartbeat',
            timestamp: Date.now()
          })
          
          try {
            client.ws.send(heartbeatMessage)
            client.failedHeartbeats++
            clients.set(clientId, client)
            
            console.log(`向用户 ${member.userId} (房间: ${room.roomId}) 发送心跳检测，失败次数: ${client.failedHeartbeats}`)
          } catch (error) {
            console.error(`发送心跳到用户 ${member.userId} (房间: ${room.roomId}) 失败:`, error)
            client.failedHeartbeats++
            clients.set(clientId, client)
          }
        } else {
          console.log(`用户 ${member.userId} (房间: ${room.roomId}) 未连接WebSocket`)
          
          if (member.userId === room.ownerId) {
            // Notify other members before deleting room
            const otherMembers = await prisma.roomMember.findMany({
              where: {
                roomId: room.id,
                userId: { not: member.userId }
              }
            })

            for (const otherMember of otherMembers) {
              const clientKey = `${room.roomId}_${otherMember.userId}`
              const client = clients.get(clientKey)
              if (client) {
                try {
                  client.ws.send(JSON.stringify({
                    type: 'room_deleted',
                    roomId: room.roomId,
                    reason: 'owner_disconnected'
                  }))
                  console.log(`通知成员 ${otherMember.userId} 房主断开连接，房间解散`)
                } catch (err) {
                  console.error(`通知成员 ${otherMember.userId} 失败:`, err)
                }
              }
            }

            await prisma.room.delete({
              where: {
                id: room.id
              }
            })
            console.log(`房主 ${member.userId} 未连接，已删除房间 ${room.roomId}`)
            return
          }
          
          const existingMember = await prisma.roomMember.findUnique({
            where: {
              roomId_userId: {
                roomId: room.id,
                userId: member.userId
              }
            }
          })
          
          if (existingMember) {
            await prisma.roomMember.delete({
              where: {
                roomId_userId: {
                  roomId: room.id,
                  userId: member.userId
                }
              }
            })
            console.log(`删除未连接的用户 ${member.userId} (房间: ${room.roomId})`)
          }
        }
        
        const updatedClient = clients.get(clientId)
        if (updatedClient && updatedClient.failedHeartbeats >= MAX_FAILED_HEARTBEATS) {
          if (member.userId === room.ownerId) {
             // Notify other members before deleting room
             const otherMembers = await prisma.roomMember.findMany({
              where: {
                roomId: room.id,
                userId: { not: member.userId }
              }
            })

            for (const otherMember of otherMembers) {
              const clientKey = `${room.roomId}_${otherMember.userId}`
              const client = clients.get(clientKey)
              if (client) {
                try {
                  client.ws.send(JSON.stringify({
                    type: 'room_deleted',
                    roomId: room.roomId,
                    reason: 'owner_timeout'
                  }))
                  console.log(`通知成员 ${otherMember.userId} 房主心跳超时，房间解散`)
                } catch (err) {
                  console.error(`通知成员 ${otherMember.userId} 失败:`, err)
                }
              }
            }

            await prisma.room.delete({
              where: {
                id: room.id
              }
            })
            clients.delete(clientId)
            console.log(`房主 ${member.userId} (房间: ${room.roomId}) 连续 ${MAX_FAILED_HEARTBEATS} 次心跳失败，已删除房间`)
            return
          }
          
          await prisma.roomMember.delete({
            where: {
              roomId_userId: {
                roomId: room.id,
                userId: member.userId
              }
            }
          })
          
          clients.delete(clientId)
          console.log(`用户 ${member.userId} (房间: ${room.roomId}) 连续 ${MAX_FAILED_HEARTBEATS} 次心跳失败，已从房间移除`)
        }
      }
      
      const remainingMembers = await prisma.roomMember.count({
        where: {
          roomId: room.id
        }
      })
      
      if (remainingMembers === 0) {
        await prisma.room.delete({
          where: {
            id: room.id
          }
        })
        console.log(`房间 ${room.roomId} 无成员，已删除`)
      }
    }
    
    console.log('心跳检测完成')
  } catch (error) {
    console.error('心跳检测错误:', error)
  }
}, HEARTBEAT_INTERVAL * 1000)

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason)
})

export { app, prisma }