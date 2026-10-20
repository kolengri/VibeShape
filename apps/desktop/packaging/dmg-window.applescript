on run arguments
    set operation to item 1 of arguments
    set installerFolder to (POSIX file (item 2 of arguments)) as alias
    set expectedPath to POSIX path of installerFolder
    tell application "Finder"
        set installerDisk to disk of installerFolder
        considering case
            if (POSIX path of (installerDisk as alias)) is not expectedPath then
                error "Finder resolved a different installer volume."
            end if
        end considering
        if operation is "configure" then
            open installerDisk
            set installerWindow to container window of installerDisk
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
            set background picture of viewOptions to file ".background:installer.png" of installerDisk
            set position of item "VibeShape.app" of installerDisk to {175, 238}
            set position of item "Applications" of installerDisk to {545, 238}
            update installerDisk without registering applications
            delay 1
            close installerWindow
            delay 1
        else if operation is "close" then
            repeat with candidateWindow in Finder windows
                try
                    considering case
                        if (POSIX path of (target of candidateWindow as alias)) is expectedPath then close candidateWindow
                    end considering
                end try
            end repeat
        else
            error "Unknown installer window operation."
        end if
    end tell
end run
