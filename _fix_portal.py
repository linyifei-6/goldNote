with open('g:/Iflow/goldnote/pages/portal/portal.wxml', 'r', encoding='utf-8-sig') as f:
    c = f.read()

# Find the exact string to remove: quiz menu-item inside workout card
old_quiz_inside = '  <view class="menu-item" bindtap="onGoQuiz">\n    <text class="menu-icon">\U0001f3c6</text>\n    <text class="menu-label">\u7ade\u731c\u7b14\u8bb0</text>\n  </view>\n    '

if old_quiz_inside in c:
    c = c.replace(old_quiz_inside, '')
    print('Removed quiz entry from inside workout card')
else:
    print('Pattern not found, checking...')
    # Debug: find the area
    idx = c.find('choice-card workout')
    if idx > 0:
        end = c.find('choice-cta', idx)
        if end > 0:
            print('Context around choice-cta:')
            print(repr(c[end-50:end+30]))

# Add proper quiz choice-card after workout card  
workout_end = '</view>\n\n  <view class="profile-modal-mask"'
quiz_card = '\n  <view class="choice-card quiz" bindtap="onGoQuiz">\n    <view class="choice-title">\u7ade\u731c\u7b14\u8bb0</view>\n    <view class="choice-desc">\u4e16\u754c\u676f\u7ade\u731c\u3001\u8d5b\u7a0b\u6d4f\u89c8\u3001\u4e0b\u6ce8\u79ef\u5206</view>\n    <view class="choice-cta">\u8fdb\u5165\u7ade\u731c\u7b14\u8bb0</view>\n  </view>'

if workout_end in c:
    c = c.replace(workout_end, quiz_card + '\n\n' + workout_end[:6] + '\n' + workout_end[6:])
    print('Added quiz choice-card after workout card')
else:
    print('Could not find insertion point')
    print('Looking for:', repr(workout_end[:50]))
    # Alternative: find profile-modal-mask
    idx2 = c.find('profile-modal-mask')
    if idx2 > 0:
        before = c.rfind('</view>', 0, idx2)
        print('Last </view> before modal:', repr(c[before:before+20]))

with open('g:/Iflow/goldnote/pages/portal/portal.wxml', 'w', encoding='utf-8') as f:
    f.write(c)
print('Done')
