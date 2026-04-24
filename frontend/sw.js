self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = {};
  }

  const title = 'New Booking - MEHRA';
  const ownerName = data.ownerName || 'Vehicle Owner';
  const service = data.service || 'service';
  const date = data.date || 'today';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: `${ownerName} booked ${service} for ${date}`,
      icon: '/static/carai.png',
      data: { appointmentId: data.id || data.appointmentId || null }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const appointmentId = event.notification?.data?.appointmentId;
  const targetUrl = appointmentId ? `/?appointmentId=${encodeURIComponent(appointmentId)}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return null;
    })
  );
});
