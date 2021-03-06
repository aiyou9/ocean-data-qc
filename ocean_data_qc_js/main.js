// //////////////////////////////////////////////////////////////////////
//  License, authors, contributors and copyright information at:       //
//  AUTHORS and LICENSE files at the root folder of this application   //
// //////////////////////////////////////////////////////////////////////

"use strict";

const path = require('path');
require('app-module-path').addPath(path.join(__dirname, 'src/js/modules'));  // change folder name to "node_modules" to avoid this?

const lg = require('logging');
const loc = require('locations');
const is_dev = require('electron-is-dev');
if (!is_dev) {
    // this is needed to load the .env file correctly with the dotenv library
    process.chdir(loc.ocean_data_qc_js);
}
require('dotenv').config()

const {app} = require('electron');
const {BrowserWindow} = require('electron');
const {ipcMain} = require('electron');
const {dialog} = require('electron');

const data = require('data')
const server = require('server');
const menu = require('menu');
const menu_actions = require('menu_actions');
var updater = require('updater');

try {
    require('electron-debug')({showDevTools: false});
} catch (ex) {
    lg.warn('>> ELECTRON DEBUG COULD NOT BE LOADED');
}

// These code can be removed when this issue is fixed
// https://stackoverflow.com/questions/54175042/python-3-7-anaconda-environment-import-ssl-dll-load-fail-error
if (process.platform == 'win32' && !is_dev) {
    if (process.env.PATH.slice(-1) != ';') {
        process.env.PATH = process.env.PATH + ';'
    }
    process.env.PATH = process.env.PATH + loc.env_lib_bin_win + ';';
    process.env.PATH = process.env.PATH + loc.env_bin_win + ';';
}

var main_window = null;      // global reference of the window object
                             // if this is not set, the window will be closed automatically

// ----------------------- APP EVENTS -------------------------- //

// Modify this line in the future if there is a better solution:
// GH issue: https://github.com/electron/electron/issues/18214
// SO solution: https://stackoverflow.com/a/57288472/4891717
app.commandLine.appendSwitch('disable-site-isolation-trials');

app.on('ready', function() {
    try {
        data.init_user_data()
    } catch(err) {
        lg.error('ERROR INITIALIZING FILES: ' + err);
    }
    if (is_dev) {
        var file_to_open = process.argv[2];  // the process.argv[1] is the ocean_data_qc_js folder
    } else {
        var file_to_open = process.argv[1];
    }
    if (typeof(file_to_open) !== 'undefined') {
        // TODO: Is file_to_open a relative path when it is open with the mouse??
        data.set({'file_to_open': file_to_open }, loc.shared_data);
    } else {
        // NOTE: Just in case the previous session was closed by force
        data.set({'file_to_open': false }, loc.shared_data);

        // TODO: Show the main loader here
    }

    main_window = new BrowserWindow({
        webPreferences: { nodeIntegration: true, }, // https://stackoverflow.com/a/55908510/4891717
        width: 1380,
        height: 820,
        icon: path.join(__dirname, 'src/img/icon.png'),
        title: 'AtlantOS Ocean Data QC!'  // if not the title ocean_data_qc is shown for a moment
        // backgroundColour: '#e8e8e7'              // TODO: try to give a desktop application color
    })
    //main_window.maximize();
    var web_contents = main_window.webContents;          // TODO: avoid globals
    //web_contents.openDevTools();     // TODO: "chromium DevTools" >> add this options to development menu (toggle)

    menu_actions.init(web_contents, server);
    menu.init(web_contents, menu_actions, server);

    menu.set_main_menu();
    server.init(web_contents, menu);
    server.go_to_welcome_window();
    server.launch_bokeh();  // bokeh initialization on the background
    server.load_bokeh_on_iframe();

    app.showExitPrompt = true
    main_window.on('close', (e) => {
        lg.info('-- ON CLOSE MAIN WINDOW');
        server.close_with_exit_prompt_dialog(e);
    })

    if (!is_dev) {
        // Autoupdater (running on production)
        web_contents.send('show-loader');  // TODO: is this OK here?
        updater.init(web_contents);
        updater.listeners();
        updater.check_for_updates();
    }
});

app.on('window-all-closed', function (event) {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q

    lg.info('-- WINDOWS ALL CLOSED');
    server.close_with_exit_prompt_dialog();
})

app.on('will-quit', function (event) {
    server.close_app();
})

app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (main_window === null) {
        createWindow();
    }
})

// ------------- RECEIVED SIGNALS FROM main_renderer.js ----------------- //

ipcMain.on('save-file', (event, arg) => {
    menu_actions.save_file(arg).then((value) => {
        event.returnValue = value;
    });
})

ipcMain.on('save-file-as', (event, arg) => {
    lg.info('-- SAVE FILE AS (MAIN.JS)')
    menu_actions.save_file_as(arg).then((value) => {
        event.returnValue = value;
    }).catch(() => {
        lg.warn('Save file as Promise Rejected');
    });
})

ipcMain.on('open-dialog', (event, arg) => {
    menu_actions.open_dialog();
})

ipcMain.on('open-octave-path-dialog', (event, arg) => {
    dialog.showOpenDialog({
            title: 'Setting Octave path folder...',
            filters: [{ name: 'Octave Path Folder', }],
            properties: ['openDirectory'],
    }).then((results) => {
        if (results['canceled'] == false) {
            var file_path = results['filePaths'][0];
            var web_contents = main_window.webContents;
            web_contents.send('set-octave-path', {'manual_octave_folder_path': file_path});
        }
    });
})

ipcMain.on('open-file', (event, arg) => {
    lg.info('-- IPC MAIN OPEN-FILE, ARG: ' + arg);
    menu_actions.open_file(arg);
})

ipcMain.on('set-bokeh-server-port', function (event, port) {
    lg.info('>> NEW PORT ASSIGNED: ' + port);
    data.set({'bokeh_port': port}, loc.shared_data);
});

ipcMain.on('set-main-menu', function(){
    menu.set_main_menu();
})

ipcMain.on('enable-watcher', function(event, args){
    var web_contents = main_window.webContents;
    web_contents.send('enable-watcher', {'mark': args.mark});
    if ('set_bokeh_menu' in args && args.set_bokeh_menu == true) {
        menu.set_bokeh_menu();
    }
})

ipcMain.on('disable-watcher', function(event, args){
    var web_contents = main_window.webContents;
    web_contents.send('disable-watcher');
})

ipcMain.on('run-tile-server', function(event, args){
    server.run_tile_server();
})


