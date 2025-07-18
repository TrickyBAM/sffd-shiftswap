import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()

/**
 * Triggered when a new matchedTrade document is created.  Sends a
 * push notification to the poster of the original shift to let them
 * know someone has accepted their shift.  The user's FCM tokens
 * must be stored on the `users` document in an array called
 * `fcmTokens`.
 */
export const onTradeMatched = functions.firestore
  .document('matchedTrades/{tradeId}')
  .onCreate(async (snapshot) => {
    const trade = snapshot.data() as any
    const posterUid: string = trade.posterUid
    const posterDoc = await admin.firestore().collection('users').doc(posterUid).get()
    const tokens: string[] = posterDoc.data()?.fcmTokens ?? []
    if (tokens.length === 0) {
      console.log('No FCM tokens for user', posterUid)
      return
    }
    const payload = {
      notification: {
        title: 'Shift Trade Accepted',
        body: `Your shift on ${trade.originalDate} has been accepted.`,
      },
    }
    await admin.messaging().sendToDevice(tokens, payload)
  })