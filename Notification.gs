/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : Notification.gs
 * Purpose   : Notification Management
 * Version   : 1.0
 * ============================================================
 */

const Notification = (() => {

  /**
   * ============================================================
   * CREATE NOTIFICATION
   * ============================================================
   */

  function create(data) {

    const notificationId =
      Utility.generateNotificationId();

    Database.notifications.insert({

      NOTIFICATION_ID:
        notificationId,

      USERNAME:
        Utility.safeString(data.username),

      ROLE:
        Utility.safeString(data.role),

      TITLE:
        Utility.safeString(data.title),

      MESSAGE:
        Utility.safeString(data.message),

      TYPE:
        Utility.safeString(data.type),

      RELATED_SUBMISSION_ID:
        Utility.safeString(
          data.submissionId
        ),

      READ_STATUS:
        "No",

      CREATED_ON:
        Utility.formatDateTime(),

      READ_ON:
        ""

    });

    return Utility.success(

      SUCCESS.SAVED,

      {

        notificationId:
          notificationId

      }

    );

  }

  /**
   * ============================================================
   * GET NOTIFICATION
   * ============================================================
   */

  function get(notificationId) {

    return Database.notifications.find(

      "NOTIFICATION_ID",

      notificationId

    );

  }

  /**
   * ============================================================
   * USER NOTIFICATIONS
   * ============================================================
   */

  function userNotifications(username) {

    return Database.notifications.findAll(

      "USERNAME",

      username

    );

  }

  /**
   * ============================================================
   * UNREAD
   * ============================================================
   */

  function unread(username) {

    return Database.notifications.unread(
      username
    );

  }

  /**
   * ============================================================
   * PART 2 CONTINUES...
   * ============================================================
   */
    /**
   * ============================================================
   * MARK AS READ
   * ============================================================
   */

  function markRead(notificationId) {

    const notification =
      get(notificationId);

    if (!notification)
      return Utility.error(
        ERROR.NOTIFICATION_NOT_FOUND
      );

    Database.notifications.markRead(
      notification.row
    );

    return Utility.success(
      SUCCESS.UPDATED
    );

  }

  /**
   * ============================================================
   * MARK ALL AS READ
   * ============================================================
   */

  function markAllRead(username) {

    const list =
      unread(username);

    list.forEach(function (item) {

      Database.notifications.markRead(
        item.row
      );

    });

    return Utility.success(
      SUCCESS.UPDATED
    );

  }

  /**
   * ============================================================
   * DELETE NOTIFICATION
   * ============================================================
   */

  function remove(notificationId) {

    const notification =
      get(notificationId);

    if (!notification)
      return Utility.error(
        ERROR.NOTIFICATION_NOT_FOUND
      );

    Database.notifications.remove(
      notification.row
    );

    return Utility.success(
      SUCCESS.UPDATED
    );

  }

  /**
   * ============================================================
   * UNREAD COUNT
   * ============================================================
   */

  function unreadCount(username) {

    return unread(username).length;

  }

  /**
   * ============================================================
   * BROADCAST TO ROLE
   * ============================================================
   */

  function broadcastRole(
    role,
    title,
    message,
    type,
    submissionId
  ) {

    const users =
      Database.users.byRole(role);

    users.forEach(function (user) {

      create({

        username:
          user.data.USERNAME,

        role:
          user.data.ROLE,

        title:
          title,

        message:
          message,

        type:
          type,

        submissionId:
          submissionId || ""

      });

    });

    return Utility.success(
      SUCCESS.SAVED
    );

  }

  /**
   * ============================================================
   * BROADCAST TO USERS
   * ============================================================
   */

  function broadcastUsers(
    usernames,
    title,
    message,
    type,
    submissionId
  ) {

    usernames.forEach(function (username) {

      const user =
        Database.users.findByUsername(
          username
        );

      if (!user)
        return;

      create({

        username:
          user.data.USERNAME,

        role:
          user.data.ROLE,

        title:
          title,

        message:
          message,

        type:
          type,

        submissionId:
          submissionId || ""

      });

    });

    return Utility.success(
      SUCCESS.SAVED
    );

  }

  /**
   * ============================================================
   * PUBLIC API
   * ============================================================
   */

  return {

    create,

    get,

    userNotifications,

    unread,

    unreadCount,

    markRead,

    markAllRead,

    remove,

    broadcastRole,

    broadcastUsers

  };

})();


