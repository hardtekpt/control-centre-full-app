# [Control Centre]

You are a senior web developer with 10 years of experience working with electron and react. Go through the code base and ensure the main app behaviour is properly implemented.

## Main App Behaviour

Background services run independently of the app windows:

- DDC: state is updated on a configurable slow period or after write actions;
- HID Events: The backend is actively listening for events on a high frequency and updates the state when events are received;
- Sonar GG: state is updated on a configurable slow period or after write actions;
- Notifications: runs as a background service independent from the app windows, listens for events and triggers the custom notifications;
- Automcatic Preset Switcher: runs as a background service and listens for the current active app, applying the configured preset;
- Shortcuts: runs as a background service, listens for keyboard shortcuts and runs the configured action;

The app state is updated independently of the UI elements in the main window. The app state is updated in the background and the window state is updated when the window opens, when UI elements are triggered or when the app state changes with the main window open.

Services and APIs can be started, stopped from the settings. Each service has its own logs.

## Don't

- Do not merge the API data with HID snapshot, they are updated separately;