on run arguments
    set operation to item 1 of arguments
    set installerFolder to (POSIX file (item 2 of arguments)) as alias
    tell application "Finder"
        if operation is "configure" then
            open installerFolder
            set installerWindow to container window of installerFolder
            set current view of installerWindow to icon view
            set toolbar visible of installerWindow to false
            set statusbar visible of installerWindow to false
            set sidebar width of installerWindow to 0
            set bounds of installerWindow to {160, 120, 880, 628}
            set viewOptions to icon view options of installerWindow
            set arrangement of viewOptions to not arranged
            set icon size of viewOptions to 112
            set text size of viewOptions to 14
            set label position of viewOptions to bottom
            set shows item info of viewOptions to false
            set shows icon preview of viewOptions to true
            set background picture of viewOptions to file ".background:installer.png" of installerFolder
            set position of item "VibeShape.app" of installerFolder to {175, 238}
            set position of item "Applications" of installerFolder to {545, 238}
            update installerFolder without registering applications
            delay 1
            close installerWindow
            delay 1
        else if operation is "close" then
            repeat with candidateWindow in Finder windows
                try
                    if (target of candidateWindow as alias) is installerFolder then close candidateWindow
                end try
            end repeat
        else
            error "Unknown installer window operation."
        end if
    end tell
end run
