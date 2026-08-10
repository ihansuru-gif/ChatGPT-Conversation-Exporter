using System;
using System.Diagnostics;
using System.IO;

class Launcher
{
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');

        Console.Title = "ChatGPT Conversation Exporter";
        Console.WriteLine("ChatGPT Conversation Exporter");
        Console.WriteLine();
        Console.WriteLine("1. Chrome 확장 관리 열기");
        Console.WriteLine("2. Edge 확장 관리 열기");
        Console.WriteLine("3. 확장 폴더 열기");
        Console.WriteLine();
        Console.WriteLine("설치: 개발자 모드 ON -> 압축해제된 확장 프로그램 로드 -> 이 폴더 선택");
        Console.WriteLine(dir);
        Console.WriteLine();
        Console.Write("번호 입력: ");

        string input = Console.ReadLine();
        if (input == "1") Open("chrome://extensions");
        else if (input == "2") Open("edge://extensions");
        else Open(dir);
    }

    static void Open(string target)
    {
        try
        {
            Process.Start(target);
        }
        catch
        {
            Process.Start("explorer.exe", target);
        }
    }
}
