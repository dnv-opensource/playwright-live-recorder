rd dist /s /q
call yarn build-fast
rd /s /q ..\hackathon-2023-playwright-live-recorder\node_modules\@dnvgl\playwright-live-recorder\dist\
xcopy dist /s ..\hackathon-2023-playwright-live-recorder\node_modules\@dnvgl\playwright-live-recorder\dist\